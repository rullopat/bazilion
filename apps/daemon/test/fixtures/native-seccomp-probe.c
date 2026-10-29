#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <sched.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/prctl.h>
#include <sys/socket.h>
#include <sys/syscall.h>
#include <sys/types.h>
#include <sys/uio.h>
#include <sys/un.h>
#include <sys/wait.h>
#include <unistd.h>

/* Controlled real-kernel probe: no host endpoint/credential or foreign process access. */
static int socket_error(int family, int type) {
  errno = 0;
  int fd = socket(family, type, 0);
  int error = fd < 0 ? errno : 0;
  if (fd >= 0) close(fd);
  return error;
}
static int fd_error(int fd) {
  errno = 0;
  return fcntl(fd, F_GETFD) < 0 ? errno : 0;
}
static int path_write_error(const char *path) {
  errno = 0;
  int fd = open(path, O_WRONLY | O_CREAT | O_TRUNC, 0600);
  int error = fd < 0 ? errno : 0;
  if (fd >= 0) { if (write(fd, "x", 1) != 1) error = errno; close(fd); }
  return error;
}
static int private_pair(void) {
  int pair[2]; char value = 0;
  if (socketpair(AF_UNIX, SOCK_STREAM, 0, pair)) return 0;
  int success = write(pair[0], "p", 1) == 1 && read(pair[1], &value, 1) == 1 && value == 'p';
  close(pair[0]); close(pair[1]);
  return success;
}
static int private_path(void) {
  struct sockaddr_un address = { .sun_family = AF_UNIX };
  strcpy(address.sun_path, "/work/job.sock");
  unlink(address.sun_path);
  int server = socket(AF_UNIX, SOCK_STREAM, 0), client = -1, accepted = -1, success = 0;
  if (server < 0) return 0;
  if (bind(server, (struct sockaddr *)&address, sizeof(address)) || listen(server, 1)) goto done;
  client = socket(AF_UNIX, SOCK_STREAM, 0);
  if (client < 0 || connect(client, (struct sockaddr *)&address, sizeof(address))) goto done;
  accepted = accept(server, NULL, NULL);
  char value = 0;
  success = accepted >= 0 && write(client, "u", 1) == 1 && read(accepted, &value, 1) == 1 && value == 'u';
done:
  if (accepted >= 0) close(accepted);
  if (client >= 0) close(client);
  close(server); unlink(address.sun_path);
  return success;
}
static int escaped_writer(void) {
  pid_t first = fork();
  if (first < 0) return 2;
  if (first > 0) {
    int status = 0;
    return waitpid(first, &status, 0) == first && WIFEXITED(status) ? WEXITSTATUS(status) : 3;
  }
  if (setsid() < 0) _exit(4);
  pid_t second = fork();
  if (second < 0) _exit(5);
  if (second > 0) _exit(0);
  close(0); close(1); close(2);
  int descriptors_closed = fd_error(0) == EBADF && fd_error(1) == EBADF && fd_error(2) == EBADF;
  signal(SIGTERM, SIG_IGN);
  for (int attempt = 0; attempt < 100 && getppid() != 1; attempt++) usleep(1000);
  if (getppid() != 1) _exit(7);
  int marker = open("escaped-marker", O_WRONLY | O_CREAT | O_APPEND, 0600);
  if (marker < 0) _exit(6);
  dprintf(marker, "{\"pid\":%d,\"parent\":%d,\"group\":%d,\"session\":%d,\"stdioClosed\":%s}\n",
    getpid(), getppid(), getpgrp(), getsid(0), descriptors_closed ? "true" : "false");
  /* Fixture expiry is only a last-resort bound, never positive settlement evidence. */
  for (int tick = 0; tick < 500; tick++) { if (write(marker, "x", 1) != 1) break; usleep(10000); }
  close(marker);
  _exit(0);
}
int main(int argc, char **argv) {
  if (argc == 2 && !strcmp(argv[1], "escaped-writer")) return escaped_writer();
  int fd3 = fd_error(3), fd4 = fd_error(4), inherited_fds = 0;
  for (int fd = 3; fd < 1024; fd++) if (fd_error(fd) != EBADF) inherited_fds++;
  errno = 0; syscall(9999); int unknown_error = errno;
  errno = 0; syscall(SYS_unshare, 0); int unshare_error = errno;
  errno = 0; syscall(SYS_setns, -1, 0); int setns_error = errno;
  errno = 0; syscall(SYS_process_vm_readv, getpid(), NULL, 0, NULL, 0, 0); int debug_error = errno;
  errno = 0; ioctl(-1, 0xb701); int ns_ioctl_error = errno;
  errno = 0; ioctl(-1, 0x5412); int terminal_error = errno;
  errno = 0; syscall(SYS_clone3, NULL, 0); int clone3_error = errno;
  int fork_ok = 0;
  pid_t child = fork();
  if (!child) _exit(setsid() >= 0 ? 0 : 1);
  if (child > 0) { int status = 0; fork_ok = waitpid(child, &status, 0) == child && WIFEXITED(status) && WEXITSTATUS(status) == 0; }
  int capability_fields = 0, zero_capabilities = 1;
  errno = 0;
  int init_mem = open("/proc/1/mem", O_RDWR);
  int init_mem_error = init_mem < 0 ? errno : 0;
  if (init_mem >= 0) close(init_mem);
  errno = 0;
  int init_read = open("/proc/1/mem", O_RDONLY);
  int init_read_error = init_read < 0 ? errno : 0;
  if (init_read >= 0) close(init_read);
  FILE *status = fopen("/proc/self/status", "r");
  if (status) {
    char line[256];
    while (fgets(line, sizeof(line), status)) {
      char field[16]; unsigned long long value;
      if (sscanf(line, "%15s %llx", field, &value) != 2) continue;
      if (!strcmp(field, "CapInh:") || !strcmp(field, "CapPrm:") || !strcmp(field, "CapEff:") || !strcmp(field, "CapBnd:") || !strcmp(field, "CapAmb:")) {
        capability_fields++; if (value) zero_capabilities = 0;
      }
    }
    fclose(status);
  }
  printf("{\"ipv4Tcp\":%d,\"ipv4Udp\":%d,\"ipv6Tcp\":%d,\"ipv6Udp\":%d,\"netlink\":%d,\"pair\":%d,\"pathIpc\":%d,\"fd3\":%d,\"fd4\":%d,\"inheritedFds\":%d,\"unknown\":%d,\"unshare\":%d,\"setns\":%d,\"debug\":%d,\"nsIoctl\":%d,\"terminal\":%d,\"clone3\":%d,\"forkSetsid\":%d,\"seccomp\":%d,\"noNewPrivs\":%d,\"zeroCaps\":%s,\"initMem\":%d,\"initMemRead\":%d,\"pid\":%d,\"workspaceWrite\":%d,\"memoryWrite\":%d,\"parentCanaryPresent\":%s}\n",
    socket_error(AF_INET, SOCK_STREAM), socket_error(AF_INET, SOCK_DGRAM),
    socket_error(AF_INET6, SOCK_STREAM), socket_error(AF_INET6, SOCK_DGRAM),
    socket_error(AF_NETLINK, SOCK_RAW), private_pair(), private_path(), fd3, fd4, inherited_fds,
    unknown_error, unshare_error, setns_error, debug_error, ns_ioctl_error, terminal_error,
    clone3_error, fork_ok, prctl(PR_GET_SECCOMP, 0, 0, 0, 0), prctl(PR_GET_NO_NEW_PRIVS, 0, 0, 0, 0),
    zero_capabilities && capability_fields == 5 ? "true" : "false", init_mem_error, init_read_error, getpid(), path_write_error("/work/probe.txt"),
    path_write_error("/work/memory/note.txt"), getenv("BAZILION_NATIVE_PARENT_CANARY") ? "true" : "false");
  return 0;
}
