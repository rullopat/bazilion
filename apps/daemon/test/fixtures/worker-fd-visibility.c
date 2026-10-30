#include <stdio.h>
#include <sys/prctl.h>
#include <unistd.h>

/* Independently owned, no credentials or files: deny proc-fd inspection until stdin EOF. */
int main(void) {
  if (prctl(PR_SET_DUMPABLE, 0, 0, 0, 0) != 0) return 2;
  puts("ready");
  fflush(stdout);
  char byte;
  while (read(STDIN_FILENO, &byte, 1) > 0) {}
  return 0;
}
