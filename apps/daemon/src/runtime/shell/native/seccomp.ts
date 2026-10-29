import { endianness } from 'node:os'

export type LinuxNativeArchitecture = 'x64' | 'arm64'
export const LINUX_NATIVE_SECCOMP_POLICY = 'ipc-only-v1'

// Public Linux UAPI: asm/unistd_64.h and asm-generic/unistd.h, 64-bit aliases.
// Explicit reviewed syscall pairs [x86-64, AArch64], NOT ranges or a host-header lookup.
// Unlisted/future syscalls default to EPERM. Namespace, mount, cross-process debugging,
// kernel administration, io_uring, named SysV/POSIX service IPC and privilege APIs are absent.
// Argument-sensitive syscalls below MUST NOT also appear in this unconditional list.
const ORDINARY = [
  [0, 63], // read
  [1, 64], // write
  [2, null], // open
  [257, 56], // openat
  [437, 437], // openat2
  [3, 57], // close
  [436, 436], // close_range
  [4, null], // stat
  [5, 80], // fstat
  [6, null], // lstat
  [262, 79], // newfstatat
  [332, 291], // statx
  [7, null], // poll
  [271, 73], // ppoll
  [23, null], // select
  [270, 72], // pselect6
  [8, 62], // lseek
  [9, 222], // mmap
  [10, 226], // mprotect
  [11, 215], // munmap
  [12, 214], // brk
  [25, 216], // mremap
  [26, 227], // msync
  [27, 232], // mincore
  [28, 233], // madvise
  [13, 134], // rt_sigaction
  [14, 135], // rt_sigprocmask
  [15, 139], // rt_sigreturn
  [130, 133], // rt_sigsuspend
  [127, 136], // rt_sigpending
  [128, 137], // rt_sigtimedwait
  [129, 138], // rt_sigqueueinfo
  [297, 240], // rt_tgsigqueueinfo
  [131, 132], // sigaltstack
  [17, 67], // pread64
  [18, 68], // pwrite64
  [19, 65], // readv
  [20, 66], // writev
  [295, 69], // preadv
  [296, 70], // pwritev
  [327, 286], // preadv2
  [328, 287], // pwritev2
  [21, null], // access
  [269, 48], // faccessat
  [439, 439], // faccessat2
  [22, null], // pipe
  [293, 59], // pipe2
  [32, 23], // dup
  [33, null], // dup2
  [292, 24], // dup3
  [24, 124], // sched_yield
  [204, 123], // sched_getaffinity
  [203, 122], // sched_setaffinity
  [143, 121], // sched_getparam
  [142, 118], // sched_setparam
  [145, 120], // sched_getscheduler
  [144, 119], // sched_setscheduler
  [146, 125], // sched_get_priority_max
  [147, 126], // sched_get_priority_min
  [148, 127], // sched_rr_get_interval
  [315, 275], // sched_getattr
  [314, 274], // sched_setattr
  [35, 101], // nanosleep
  [230, 115], // clock_nanosleep
  [36, 102], // getitimer
  [38, 103], // setitimer
  [37, null], // alarm
  [34, null], // pause
  [39, 172], // getpid
  [110, 173], // getppid
  [186, 178], // gettid
  [102, 174], // getuid
  [104, 176], // getgid
  [107, 175], // geteuid
  [108, 177], // getegid
  [115, 158], // getgroups
  [116, 159], // setgroups
  [105, 146], // setuid
  [106, 144], // setgid
  [113, 145], // setreuid
  [114, 143], // setregid
  [117, 147], // setresuid
  [118, 148], // getresuid
  [119, 149], // setresgid
  [120, 150], // getresgid
  [122, 151], // setfsuid
  [123, 152], // setfsgid
  [109, 154], // setpgid
  [111, null], // getpgrp
  [112, 157], // setsid: containment must not depend on the original group
  [121, 155], // getpgid
  [124, 156], // getsid
  [40, 71], // sendfile
  [326, 285], // copy_file_range
  [275, 76], // splice
  [276, 77], // tee
  [278, 75], // vmsplice
  [42, 203], // connect
  [43, 202], // accept
  [288, 242], // accept4
  [44, 206], // sendto
  [45, 207], // recvfrom
  [46, 211], // sendmsg
  [47, 212], // recvmsg
  [307, 269], // sendmmsg
  [299, 243], // recvmmsg
  [48, 210], // shutdown
  [49, 200], // bind
  [50, 201], // listen
  [51, 204], // getsockname
  [52, 205], // getpeername
  [54, 208], // setsockopt
  [55, 209], // getsockopt
  [57, null], // fork
  [58, null], // vfork
  [59, 221], // execve
  [322, 281], // execveat
  [60, 93], // exit
  [231, 94], // exit_group
  [61, 260], // wait4
  [247, 95], // waitid
  [62, 129], // kill
  [200, 130], // tkill
  [234, 131], // tgkill
  [424, 424], // pidfd_send_signal: only in-namespace pids/fds, never inherited host fds
  [434, 434], // pidfd_open (not pidfd_getfd or namespace ioctls)
  [63, 160], // uname
  [72, 25], // fcntl
  [73, 32], // flock
  [74, 82], // fsync
  [75, 83], // fdatasync
  [277, 84], // sync_file_range
  [306, 267], // syncfs
  [76, 45], // truncate
  [77, 46], // ftruncate
  [78, null], // getdents
  [217, 61], // getdents64
  [79, 17], // getcwd
  [80, 49], // chdir
  [81, 50], // fchdir
  [82, null], // rename
  [264, 38], // renameat
  [316, 276], // renameat2
  [83, null], // mkdir
  [258, 34], // mkdirat
  [84, null], // rmdir
  [85, null], // creat
  [86, null], // link
  [265, 37], // linkat
  [87, null], // unlink
  [263, 35], // unlinkat
  [88, null], // symlink
  [266, 36], // symlinkat
  [89, null], // readlink
  [267, 78], // readlinkat
  [90, null], // chmod
  [91, 52], // fchmod
  [268, 53], // fchmodat
  [452, 452], // fchmodat2
  [92, null], // chown
  [93, 55], // fchown
  [94, null], // lchown
  [260, 54], // fchownat
  [95, 166], // umask
  [96, 169], // gettimeofday
  [97, 163], // getrlimit
  [160, 164], // setrlimit
  [302, 261], // prlimit64
  [98, 165], // getrusage
  [99, 179], // sysinfo
  [100, 153], // times
  [201, null], // time
  [140, 141], // getpriority
  [141, 140], // setpriority
  [137, 43], // statfs
  [138, 44], // fstatfs
  [221, 223], // fadvise64
  [285, 47], // fallocate
  [187, 213], // readahead
  [188, 5], // setxattr
  [189, 6], // lsetxattr
  [190, 7], // fsetxattr
  [191, 8], // getxattr
  [192, 9], // lgetxattr
  [193, 10], // fgetxattr
  [194, 11], // listxattr
  [195, 12], // llistxattr
  [196, 13], // flistxattr
  [197, 14], // removexattr
  [198, 15], // lremovexattr
  [199, 16], // fremovexattr
  [132, null], // utime
  [235, null], // utimes
  [261, null], // futimesat
  [280, 88], // utimensat
  [202, 98], // futex
  [449, 449], // futex_waitv
  [454, 454], // futex_wake
  [455, 455], // futex_wait
  [456, 456], // futex_requeue
  [218, 96], // set_tid_address
  [273, 99], // set_robust_list
  [274, 100], // get_robust_list
  [219, 128], // restart_syscall
  [149, 228], // mlock
  [325, 284], // mlock2
  [150, 229], // munlock
  [151, 230], // mlockall
  [152, 231], // munlockall
  [309, 168], // getcpu
  [158, null], // arch_prctl
  [334, 293], // rseq
  [324, 283], // membarrier
  [319, 279], // memfd_create
  [462, 462], // mseal
  [318, 278], // getrandom
  [228, 113], // clock_gettime
  [229, 114], // clock_getres
  [222, 107], // timer_create
  [223, 110], // timer_settime
  [224, 108], // timer_gettime
  [225, 109], // timer_getoverrun
  [226, 111], // timer_delete
  [283, 85], // timerfd_create
  [286, 86], // timerfd_settime
  [287, 87], // timerfd_gettime
  [213, null], // epoll_create
  [291, 20], // epoll_create1
  [233, 21], // epoll_ctl
  [232, null], // epoll_wait
  [281, 22], // epoll_pwait
  [441, 441], // epoll_pwait2
  [284, null], // eventfd
  [290, 19], // eventfd2
  [282, null], // signalfd
  [289, 74], // signalfd4
  [253, null], // inotify_init
  [294, 26], // inotify_init1
  [254, 27], // inotify_add_watch
  [255, 28], // inotify_rm_watch
  [239, 236], // get_mempolicy
  [238, 237], // set_mempolicy
  [450, 450], // set_mempolicy_home_node
  [237, 235], // mbind
  [125, 90], // capget
] as const

// seccomp_data: nr @0, arch @4, six uint64 args @16. Admitted ABIs are little-endian.
const LD_W_ABS = 0x20
const JEQ_K = 0x15
const JSET_K = 0x45
const AND_K = 0x54
const RET_K = 0x06
const ALLOW = 0x7fff0000
const KILL_PROCESS = 0x80000000
const DENY = 0x00050001 // SECCOMP_RET_ERRNO | EPERM
const NO_CLONE3 = 0x00050026 // ENOSYS: libc can use the separately constrained legacy clone
const NAMESPACE_FLAGS = 0x7e020080 // NEW{CGROUP,UTS,IPC,USER,PID,NET,NS,TIME}

type Instruction = readonly [code: number, jt: number, jf: number, k: number]
const load = (offset: number): Instruction => [LD_W_ABS, 0, 0, offset]
const equal = (value: number, yes = 0, no = 1): Instruction => [JEQ_K, yes, no, value]
const ret = (value: number): Instruction => [RET_K, 0, 0, value]
const highWordZero: readonly Instruction[] = [load(20), equal(0, 1, 0), ret(DENY)]

/**
 * Compile a closed mandatory policy, never supplied by a model/worker. This is defense in depth:
 * admission MUST also establish namespaces, no-new-privileges, zero capabilities, a safe filesystem
 * view and descriptor closure. AF_UNIX is safe only with those private paths/namespace boundaries;
 * this filter cannot revoke an already-open connected host socket.
 */
export function compileLinuxSeccompFilter(architecture: LinuxNativeArchitecture): Buffer {
  if (!['x64', 'arm64'].includes(architecture) || endianness() !== 'LE') {
    throw new Error('Native Linux syscall protection is unavailable')
  }
  const index = architecture === 'x64' ? 0 : 1
  const sys =
    architecture === 'x64'
      ? { audit: 0xc000003e, socket: 41, socketpair: 53, clone: 56, ioctl: 16, prctl: 157 }
      : { audit: 0xc00000b7, socket: 198, socketpair: 199, clone: 220, ioctl: 29, prctl: 167 }
  const program: Instruction[] = [load(4), equal(sys.audit, 1, 0), ret(KILL_PROCESS), load(0)]
  if (architecture === 'x64') program.push([JSET_K, 0, 1, 0x40000000], ret(KILL_PROCESS))
  const rule = (number: number, body: readonly Instruction[]) => {
    if (body.length > 255) throw new Error('Native Linux syscall protection is unavailable')
    program.push(equal(number, 0, body.length), ...body)
  }
  for (const number of [sys.socket, sys.socketpair]) {
    rule(number, [...highWordZero, load(16), equal(1, 1, 0), ret(DENY), ret(ALLOW)])
  }
  rule(sys.clone, [
    ...highWordZero,
    load(16),
    [JSET_K, 0, 1, NAMESPACE_FLAGS],
    ret(DENY),
    ret(ALLOW),
  ])
  rule(435, [ret(NO_CLONE3)])
  rule(sys.ioctl, [
    load(24),
    equal(0x5412),
    ret(DENY), // TIOCSTI
    equal(0x541c),
    ret(DENY), // TIOCLINUX
    equal(0x541d),
    ret(DENY), // TIOCCONS
    [AND_K, 0, 0, 0xff00],
    equal(0xb700),
    ret(DENY), // nsfs namespace acquisition/translation, including future commands
    equal(0xff00),
    ret(DENY), // pidfs namespace acquisition, including future commands
    ret(ALLOW),
  ])
  // Closed benign prctl options; unknown future options cannot create a new privilege path.
  const prctlOptions = [
    1, 2, 3, 4, 7, 9, 10, 11, 12, 13, 14, 15, 16, 19, 20, 21, 23, 25, 26, 27, 29, 30, 31, 32, 33,
    34, 36, 37, 38, 39, 40, 41, 42, 45, 46, 50, 51, 52, 53, 54, 55, 56, 58, 60, 61, 62, 63, 64,
  ]
  rule(sys.prctl, [
    ...highWordZero,
    load(16),
    ...prctlOptions.flatMap((option) => [equal(option), ret(ALLOW)]),
    ret(DENY),
  ])
  const numbers = new Set<number>()
  for (const pair of ORDINARY) {
    const number = pair[index]
    if (number !== null) numbers.add(number)
  }
  const sensitive = [sys.socket, sys.socketpair, sys.clone, 435, sys.ioctl, sys.prctl]
  if (sensitive.some((number) => numbers.has(number))) {
    throw new Error('Native Linux syscall protection is unavailable')
  }
  for (const number of [...numbers].sort((a, b) => a - b)) rule(number, [ret(ALLOW)])
  program.push(ret(DENY))
  if (program.length > 4096) throw new Error('Native Linux syscall protection is unavailable')
  const buffer = Buffer.alloc(program.length * 8)
  program.forEach(([code, jt, jf, k], position) => {
    const offset = position * 8
    buffer.writeUInt16LE(code, offset)
    buffer.writeUInt8(jt, offset + 2)
    buffer.writeUInt8(jf, offset + 3)
    buffer.writeUInt32LE(k, offset + 4)
  })
  return buffer
}
