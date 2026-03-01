"""
Edit Factory - Desktop utilities.
CLI for process cleanup, called by Electron launcher.

Usage:
    python -m app.desktop cleanup --ports 8000 3000
    python -m app.desktop ensure-dirs
"""
import sys
import argparse
import logging

logger = logging.getLogger(__name__)


def kill_processes_on_port(port: int) -> int:
    """Kill all processes listening on a given port, including child trees.

    Returns count of top-level processes killed.
    """
    import psutil

    killed = 0
    try:
        for conn in psutil.net_connections(kind='inet'):
            if conn.laddr.port == port and conn.pid:
                try:
                    proc = psutil.Process(conn.pid)
                    # Kill children first (uvicorn workers, node children)
                    children = proc.children(recursive=True)
                    for child in children:
                        try:
                            child.kill()
                        except (psutil.NoSuchProcess, psutil.AccessDenied):
                            pass
                    proc.kill()
                    killed += 1
                    logger.info(f"Killed PID {conn.pid} on port {port}")
                except psutil.NoSuchProcess:
                    pass  # Process already exited
                except psutil.AccessDenied as e:
                    logger.warning(f"Access denied killing PID {conn.pid} on port {port}: {e}")
    except psutil.AccessDenied:
        logger.warning(f"Access denied scanning connections for port {port}")
    except Exception as e:
        logger.error(f"Error scanning connections for port {port}: {e}")
    return killed


def cmd_cleanup(args):
    """Kill orphaned processes on specified ports."""
    total = 0
    for port in args.ports:
        n = kill_processes_on_port(port)
        print(f"port {port}: killed {n} processes")
        total += n
    return total


def cmd_ensure_dirs(args):
    """Create AppData directory structure for desktop mode."""
    from app.config import get_settings
    settings = get_settings()
    settings.ensure_dirs()
    print(f"Directories ensured at: {settings.base_dir}")


def main():
    parser = argparse.ArgumentParser(
        description="Edit Factory desktop utilities"
    )
    subparsers = parser.add_subparsers(dest="command", help="Available commands")

    # cleanup command
    cleanup_parser = subparsers.add_parser(
        "cleanup", help="Kill orphaned processes on ports"
    )
    cleanup_parser.add_argument(
        "--ports", nargs="+", type=int, default=[8000, 3000],
        help="Ports to clean up (default: 8000 3000)"
    )

    # ensure-dirs command
    subparsers.add_parser(
        "ensure-dirs", help="Create AppData directories for desktop mode"
    )

    args = parser.parse_args()
    if args.command == "cleanup":
        cmd_cleanup(args)
    elif args.command == "ensure-dirs":
        cmd_ensure_dirs(args)
    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
