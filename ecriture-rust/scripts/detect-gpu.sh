#!/usr/bin/env bash
# Inspects the machine currently running this script and prints which
# `cargo build --features gpu-*` flag (if any) is worth trying for GPU
# acceleration of the local Gemma engine - see the "GPU acceleration"
# section of ../../README.md for what each feature needs installed.
#
# This never *decides* for you: Cargo features are compile-time (native
# code linking), so there is no way to ship one binary that auto-selects
# a backend at runtime. This script only reports what it can detect on
# THIS machine, so you don't have to know your own hardware/driver setup
# in advance. A CPU-only recommendation is always safe and always works.
#
# Usage: ./detect-gpu.sh

set -u

have() { command -v "$1" >/dev/null 2>&1; }

os="$(uname -s)"
recommend=""
notes=()

if [ "$os" = "Darwin" ]; then
    recommend="gpu-metal"
    notes+=("macOS detected - Metal is built into the OS, no extra SDK needed beyond Xcode Command Line Tools.")
elif [ "$os" = "Linux" ]; then
    gpu_lines=""
    if have lspci; then
        gpu_lines="$(lspci 2>/dev/null | grep -iE 'vga|3d|display')"
    fi

    has_nvidia=false
    has_amd=false
    has_intel=false
    if echo "$gpu_lines" | grep -qi nvidia; then has_nvidia=true; fi
    if echo "$gpu_lines" | grep -qiE 'amd|ati|radeon'; then has_amd=true; fi
    if echo "$gpu_lines" | grep -qi intel; then has_intel=true; fi
    if have nvidia-smi && nvidia-smi -L >/dev/null 2>&1; then has_nvidia=true; fi

    if [ -z "$gpu_lines" ] && [ "$has_nvidia" = false ] && ! have lspci; then
        notes+=("Could not enumerate PCI devices (no lspci and no nvidia-smi) - detection is incomplete.")
    fi

    if [ "$has_nvidia" = true ]; then
        notes+=("NVIDIA GPU detected.")
        if have nvcc || [ -d /usr/local/cuda ]; then
            recommend="gpu-cuda"
            notes+=("CUDA toolkit appears to be installed - gpu-cuda should give the best performance.")
        else
            notes+=("No CUDA toolkit found (nvcc not on PATH, no /usr/local/cuda). Install the CUDA Toolkit for gpu-cuda, or use gpu-vulkan below without it.")
        fi
    elif [ "$has_amd" = true ]; then
        notes+=("AMD GPU detected.")
        if have rocminfo || [ -d /opt/rocm ]; then
            recommend="gpu-rocm"
            notes+=("ROCm appears to be installed - gpu-rocm should give the best performance.")
        else
            notes+=("No ROCm install found (rocminfo not on PATH, no /opt/rocm). Install ROCm for gpu-rocm, or use gpu-vulkan below without it.")
        fi
    elif [ "$has_intel" = true ]; then
        notes+=("Intel GPU detected. There's no dedicated Intel feature (llama.cpp's SYCL backend isn't wired into the bindings this app uses) - gpu-vulkan is the way to reach it, if this GPU exposes a Vulkan driver (e.g. Mesa's ANV on Linux).")
    fi

    if [ -z "$recommend" ]; then
        # Either no vendor-specific SDK, or no discrete GPU was identified
        # (or lspci itself is unavailable) - see if a Vulkan driver is
        # usable as the cross-vendor fallback.
        if have vulkaninfo && vulkaninfo --summary >/dev/null 2>&1; then
            recommend="gpu-vulkan"
            notes+=("A working Vulkan driver was detected (vulkaninfo succeeded) - gpu-vulkan should work.")
        elif [ -e /dev/dri ] && [ -n "$(ls -A /dev/dri 2>/dev/null)" ]; then
            notes+=("A GPU render node exists at /dev/dri, but vulkaninfo isn't installed to confirm a working Vulkan driver. Install your GPU vendor's Vulkan driver package (e.g. mesa-vulkan-drivers) and libvulkan-dev + glslc (see README), then re-run this script.")
        else
            notes+=("No GPU render node found at /dev/dri - this looks like a CPU-only machine (or a container without GPU passthrough). CPU-only is the correct/only choice here.")
        fi
    fi
elif [[ "$os" == MINGW* || "$os" == MSYS* || "$os" == CYGWIN* ]]; then
    notes+=("Windows detected via a POSIX shell - run this from PowerShell instead isn't supported by this script. Check Device Manager for your GPU vendor and see the README's GPU acceleration table; gpu-vulkan additionally needs the Vulkan SDK and VULKAN_SDK set on Windows.")
else
    notes+=("Unrecognized OS '$os' - see the README's GPU acceleration section and pick the feature matching your hardware manually.")
fi

echo "=== ecriture-rust GPU detection ==="
for n in "${notes[@]}"; do
    echo "- $n"
done
echo
if [ -n "$recommend" ]; then
    echo "Recommended: cargo build --features $recommend"
    echo "(run from ecriture-rust/src-tauri; or from ecriture-rust/ecriture-core to build just the core crate)"
else
    echo "Recommended: no gpu-* feature (CPU-only build) - this is the default and always works:"
    echo "  cargo build"
fi
