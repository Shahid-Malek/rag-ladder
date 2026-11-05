#!/usr/bin/env bash
# Owner-run on the Linux VM only. Never formats an existing unknown file/device.
set -euo pipefail
umask 077

image=${1:-/var/lib/rag-runtime.img}
runtime_dir=${2:-/srv/rag-runtime}
size=1073741824

fail() { echo "Refused: $*" >&2; exit 1; }
[[ $(uname -s) == Linux ]] || fail "Linux is required"
[[ $(id -u) == 0 ]] || fail "run as root on the VM"
[[ $image =~ ^/[A-Za-z0-9_./-]+$ && $runtime_dir =~ ^/[A-Za-z0-9_./-]+$ ]] || fail "absolute paths without whitespace are required"
[[ ! -L $image && ! -L $runtime_dir ]] || fail "symlinks are not accepted"
for binary in fallocate mkfs.ext4 blkid mount mountpoint findmnt stat losetup readlink find chmod chown; do
    command -v "$binary" >/dev/null || fail "missing $binary"
done
[[ -d $(dirname "$image") ]] || fail "image parent directory must already exist"
if [[ -e $image ]]; then
    [[ -f $image && $(stat -c %s "$image") == "$size" ]] || fail "existing image has the wrong type/size"
    [[ $(blkid -p -s TYPE -o value "$image") == ext4 && $(blkid -p -s LABEL -o value "$image") == rag-runtime ]] || fail "existing image was not provisioned by this script"
else
    # noclobber prevents replacing a file that appeared after the existence check.
    (set -o noclobber; : > "$image") || fail "image appeared concurrently"
    fallocate -l "$size" "$image"
    mkfs.ext4 -q -F -m 0 -L rag-runtime "$image"
fi
chmod 600 "$image"
if mountpoint -q "$runtime_dir"; then
    source=$(findmnt -n -o SOURCE --target "$runtime_dir")
    [[ $source == /dev/loop* ]] || fail "mount is not our loop filesystem"
    backing=$(losetup -n -O BACK-FILE "$source")
    [[ $(readlink -f "$backing") == $(readlink -f "$image") ]] || fail "mount uses a different image"
else
    [[ ! -e $runtime_dir || -d $runtime_dir ]] || fail "mount target is not a directory"
    mkdir -p "$runtime_dir"
    [[ -z $(find "$runtime_dir" -mindepth 1 -maxdepth 1 -print -quit) ]] || fail "mount target contains existing files"
    mount -o loop,rw,nodev,nosuid,noexec "$image" "$runtime_dir"
fi
options=$(findmnt -n -o OPTIONS --target "$runtime_dir")
for flag in nodev nosuid noexec; do
    [[ ,$options, == *,$flag,* ]] || fail "required mount option $flag is absent"
done
[[ $(stat -f -c %S "$runtime_dir") -gt 0 ]] || fail "filesystem check failed"
chown 10001:10001 "$runtime_dir"
chmod 700 "$runtime_dir"
echo "Ready: $runtime_dir (dedicated 1 GiB image, UID/GID 10001, mode 0700)"
echo "For reboot persistence, add this line once to /etc/fstab, then verify mount -a:"
printf '%s %s ext4 loop,rw,nodev,nosuid,noexec 0 0\n' "$image" "$runtime_dir"
