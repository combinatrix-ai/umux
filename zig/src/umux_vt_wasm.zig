const std = @import("std");
const ghostty_vt = @import("ghostty-vt");

const Allocator = std.mem.Allocator;
const Terminal = ghostty_vt.Terminal;
const ReadonlyStream = @TypeOf(@as(*Terminal, undefined).vtStream());
const TerminalFormatter = ghostty_vt.formatter.TerminalFormatter;

fn alloc() Allocator {
    return std.heap.wasm_allocator;
}

const Handle = struct {
    terminal: Terminal,
    stream: ReadonlyStream,

    pub fn init(cols: u16, rows: u16) !*Handle {
        const a = alloc();
        const self = try a.create(Handle);
        self.* = .{
            .terminal = try Terminal.init(a, .{ .cols = cols, .rows = rows }),
            .stream = undefined,
        };
        self.stream = self.terminal.vtStream();

        // Ensure a deterministic blank screen on init. Some programs assume
        // a cleared viewport; also helps avoid any allocator-reuse artifacts
        // showing up in formatted output.
        try self.stream.nextSlice("\x1b[2J\x1b[H");
        return self;
    }

    pub fn deinit(self: *Handle) void {
        const a = alloc();
        self.stream.deinit();
        self.terminal.deinit(a);
        a.destroy(self);
    }
};

// -----------------------------------------------------------------------------
// Host memory helpers (Node / browser)
// -----------------------------------------------------------------------------

export fn umux_vt_alloc_u8_array(len: usize) ?[*]u8 {
    const a = alloc();
    const buf = a.alloc(u8, len) catch return null;
    return buf.ptr;
}

export fn umux_vt_free_u8_array(ptr: [*]u8, len: usize) void {
    const a = alloc();
    a.free(ptr[0..len]);
}

// -----------------------------------------------------------------------------
// Terminal lifecycle
// -----------------------------------------------------------------------------

export fn umux_vt_terminal_new(cols: u16, rows: u16) ?*Handle {
    return Handle.init(cols, rows) catch return null;
}

export fn umux_vt_terminal_free(handle: *Handle) void {
    handle.deinit();
}

export fn umux_vt_terminal_resize(handle: *Handle, cols: u16, rows: u16) void {
    handle.terminal.resize(alloc(), cols, rows) catch {};
}

export fn umux_vt_terminal_feed(handle: *Handle, data_ptr: [*]const u8, data_len: usize) void {
    // This updates terminal state but ignores any sequences that would require
    // responses (queries, etc.). Perfect for "render-only" embeddings.
    _ = handle.stream.nextSlice(data_ptr[0..data_len]) catch {};
}

// -----------------------------------------------------------------------------
// Snapshotting
// -----------------------------------------------------------------------------

pub const SnapshotFormat = enum(u8) {
    plain = 0,
    vt = 1,
};

export fn umux_vt_terminal_snapshot(
    handle: *Handle,
    format_raw: u8,
    out_len: *usize,
) ?[*]u8 {
    const a = alloc();

    var builder: std.Io.Writer.Allocating = .init(a);
    defer builder.deinit();

    const format: SnapshotFormat = @enumFromInt(format_raw);
    const opts: ghostty_vt.formatter.Options = switch (format) {
        .plain => .plain,
        .vt => .vt,
    };

    var formatter: TerminalFormatter = .init(&handle.terminal, opts);

    // umux capture semantics: snapshot the *visible viewport* only.
    // (The underlying screen can include scrollback history.)
    const pages = handle.terminal.screens.active.pages;
    const tl = pages.getTopLeft(.viewport);
    const br = pages.getBottomRight(.viewport) orelse tl;
    const sel = ghostty_vt.Selection.init(tl, br, false);
    formatter.content = .{ .selection = sel };

    // Avoid emitting palette OSC 4 sequences in VT output; the snapshot should
    // look like a normal screen dump, not a full terminal state replay.
    if (format == .vt) formatter.extra.palette = false;
    formatter.format(&builder.writer) catch return null;

    const out = builder.writer.buffered();
    out_len.* = out.len;

    const buf = a.alloc(u8, out.len) catch return null;
    @memcpy(buf, out);
    return buf.ptr;
}

