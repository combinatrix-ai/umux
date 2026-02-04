const std = @import("std");

pub fn build(b: *std.Build) void {
    const optimize = b.standardOptimizeOption(.{});
    const target = b.standardTargetOptions(.{});

    const lib_mod = b.createModule(.{
        .root_source_file = b.path("src/umux_vt_wasm.zig"),
        .target = target,
        .optimize = optimize,
    });

    // Keep this as a lazy dependency so users who never build the wasm
    // engine don't have to fetch Ghostty's Zig dependencies.
    if (b.lazyDependency("ghostty", .{
        .target = target,
        .optimize = optimize,
        // Disable SIMD to avoid pulling in C/C++ SIMD shims that require libc
        // and a C++ runtime in wasm builds. This keeps the module portable
        // (and still correct, just slower).
        .simd = false,
    })) |dep| {
        lib_mod.addImport("ghostty-vt", dep.module("ghostty-vt"));
    } else {
        @panic("Missing dependency: ghostty (expected ../vendor/ghostty)");
    }

    const exe = b.addExecutable(.{
        .name = "umux-ghostty-vt",
        .root_module = lib_mod,
        .version = std.SemanticVersion{ .major = 0, .minor = 0, .patch = 0 },
    });

    // Export C ABI symbols + memory for JS hosts.
    exe.rdynamic = true;
    exe.entry = .disabled;
    if (target.result.cpu.arch.isWasm() and target.result.os.tag == .wasi) {
        // We're building a library-style module (no `_start`), not a command.
        exe.wasi_exec_model = .reactor;
    }

    b.installArtifact(exe);

    const build_step = b.step("wasm", "Build the umux ghostty-vt wasm module");
    build_step.dependOn(b.getInstallStep());
}

