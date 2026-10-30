#define _DARWIN_C_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <mach/mach.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ptrace.h>
#include <sys/types.h>
#include <sys/sysctl.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

/* Controlled canary only. Self expiry is never settlement or signalling authority. */
int main(int argc, char **argv) {
  if (argc != 2 && argc != 3) return 2;
  if (argc == 3 && !strcmp(argv[2], "probe-fds")) {
    int count = 0;
    for (int fd = 3; fd < 1024; fd++) if (fcntl(fd, F_GETFD) >= 0) count++;
    printf("{\"inherited\":%d}\n", count);
    return 0;
  }
  if (argc == 3 && !strcmp(argv[2], "probe-args")) {
    pid_t target = (pid_t)strtol(argv[1], NULL, 10);
    if (target <= 1 || target == getpid()) return 8;
    int mib[3] = {CTL_KERN, KERN_PROCARGS2, target};
    char bytes[65536]; size_t size = sizeof(bytes);
    const char marker[] = "BAZILION_NATIVE_CONTROLLED_OUTSIDE_ARG";
    errno = 0;
    int status = sysctl(mib, 3, bytes, &size, NULL, 0), error = errno, seen = 0;
    if (status == 0) for (size_t i = 0; i + sizeof(marker) - 1 <= size; i++) {
      if (!memcmp(bytes + i, marker, sizeof(marker) - 1)) { seen = 1; break; }
    }
    printf("{\"status\":%d,\"errno\":%d,\"marker\":%d}\n", status, error, seen);
    return 0;
  }
  if (argc == 3 && !strcmp(argv[2], "probe-controller")) {
    pid_t target = (pid_t)strtol(argv[1], NULL, 10);
    if (target <= 1 || target == getpid()) return 8;
    mach_port_t task = MACH_PORT_NULL;
    kern_return_t task_status = task_for_pid(mach_task_self(), target, &task);
    if (task_status == KERN_SUCCESS) mach_port_deallocate(mach_task_self(), task);
    errno = 0;
    int attached = ptrace(PT_ATTACHEXC, target, NULL, 0), attach_errno = errno;
    if (attached == 0) ptrace(PT_DETACH, target, NULL, 0);
    printf("{\"taskPort\":%d,\"attach\":%d,\"attachErrno\":%d}\n", task_status, attached, attach_errno);
    return 0;
  }
  pid_t first = fork();
  if (first < 0) return 3;
  if (first > 0) {
    int status = 0;
    return waitpid(first, &status, 0) == first && WIFEXITED(status) ? WEXITSTATUS(status) : 4;
  }
  if (setsid() < 0) _exit(5);
  pid_t second = fork();
  if (second < 0) _exit(6);
  if (second > 0) _exit(0);
  close(0); close(1); close(2);
  signal(SIGTERM, SIG_IGN);
  int deny_attach = -2, deny_errno = 0;
  if (argc == 3 && !strcmp(argv[2], "deny-attach")) {
    errno = 0;
    deny_attach = ptrace(PT_DENY_ATTACH, 0, NULL, 0);
    deny_errno = errno;
  }
  int fd = open(argv[1], O_WRONLY | O_CREAT | O_APPEND, 0600);
  if (fd < 0) _exit(7);
  dprintf(fd, "{\"pid\":%d,\"parent\":%d,\"group\":%d,\"session\":%d,\"denyAttach\":%d,\"denyErrno\":%d}\n", getpid(), getppid(), getpgrp(), getsid(0), deny_attach, deny_errno);
  int linger = argc == 3 && !strcmp(argv[2], "linger");
  struct timespec begin, now;
  if (linger && clock_gettime(CLOCK_MONOTONIC, &begin) != 0) _exit(9);
  for (int tick = 0; ; tick++) {
    if (linger) {
      if (clock_gettime(CLOCK_MONOTONIC, &now) != 0) _exit(9);
      double elapsed = (double)(now.tv_sec - begin.tv_sec) + (double)(now.tv_nsec - begin.tv_nsec) / 1000000000.0;
      if (elapsed >= 6.0) break;
    } else if (tick >= 300) break;
    if (write(fd, "x", 1) != 1) break;
    usleep(10000);
  }
  if (linger) write(fd, "\nfinished\n", 10);
  close(fd);
  _exit(0);
}
