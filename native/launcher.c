/* Native Messaging entry point with its own macOS app identity.
 * Keeps the signed launcher alive while Python handles one stdio request.
 * No shell, network service or persistent process is involved.
 */
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <mach-o/dyld.h>
#include <spawn.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <unistd.h>

extern char **environ;

int main(int argc, char **argv) {
    if (argc != 2) return 64;
    char executable[PATH_MAX], root[PATH_MAX];
    uint32_t capacity = sizeof(executable);
    if (_NSGetExecutablePath(executable, &capacity) != 0 || !realpath(executable, root)) return 1;
    /* <native>/MarkView Local Save.app/Contents/MacOS/MarkView Local Save */
    for (int index = 0; index < 4; index++) {
        char *slash = strrchr(root, '/');
        if (!slash || slash == root) return 1;
        *slash = '\0';
    }
    char interpreter_file[PATH_MAX], script[PATH_MAX], python[PATH_MAX];
    int first = snprintf(interpreter_file, sizeof(interpreter_file), "%s/python-path", root);
    int second = snprintf(script, sizeof(script), "%s/save_host.py", root);
    if (first < 0 || first >= (int)sizeof(interpreter_file) || second < 0 || second >= (int)sizeof(script)) return 1;
    int descriptor = open(interpreter_file, O_RDONLY | O_NOFOLLOW);
    if (descriptor < 0) return 1;
    struct stat info;
    if (fstat(descriptor, &info) != 0 || !S_ISREG(info.st_mode) || info.st_uid != geteuid() ||
        (info.st_mode & 0022) || info.st_size < 2 || info.st_size >= (off_t)sizeof(python)) {
        close(descriptor);
        return 1;
    }
    ssize_t length = read(descriptor, python, sizeof(python) - 1);
    close(descriptor);
    if (length != info.st_size || python[0] != '/') return 1;
    for (ssize_t index = 0; index < length; index++) {
        if ((unsigned char)python[index] < 32) return 1;
    }
    python[length] = '\0';
    char *arguments[] = {python, script, argv[1], NULL};
    pid_t child;
    if (posix_spawn(&child, python, NULL, NULL, arguments, environ) != 0) return 1;
    int status;
    while (waitpid(child, &status, 0) < 0) {
        if (errno != EINTR) return 1;
    }
    return WIFEXITED(status) ? WEXITSTATUS(status) : 1;
}
