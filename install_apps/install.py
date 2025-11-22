#!/usr/bin/env python3
from context import EnvironmentContext
from manager import PACKAGE_MANAGER_REGISTRY
from pathlib import Path
from app import AppRegistry

APP_LISTS_DIR = Path(__file__).parent / 'app_lists'

def parse_args():
    from argparse import ArgumentParser
    p = ArgumentParser()
    p.add_argument('-m','--mode', choices=['auto'] + PACKAGE_MANAGER_REGISTRY.get_all_managers(), default='auto', help=f'Installation mode: {["auto"] + PACKAGE_MANAGER_REGISTRY.get_all_managers()}.')
    p.add_argument('-f','--force-reinstall', action='store_true', help='Force reinstall packages.')
    p.add_argument('-a','--app-list', type=str, choices=[p.stem for p in APP_LISTS_DIR.glob('*.txt')]+['full'], default=None, help='Specify which app list to install (e.g., minimal, full).')
    p.add_argument('-c', '--custom-bin-path', type=str, default=None, help='Custom binary path for Miniforge binary path.')
    return p.parse_args()

def choose_mode(env_ctx: EnvironmentContext) -> str:
    if env_ctx.has_sudo:
        return 'brew'
    else:
        return 'miniforge'

def main() -> None:
    args = parse_args()
    # --- detect environment ---
    env_ctx = EnvironmentContext.detect()
    mode = choose_mode(env_ctx) if args.mode == 'auto' else args.mode
    env_ctx.print_info()
    # --- app list ---
    if args.app_list is None:
        raise ValueError("Please specify an app list using --app-list.")
    app_registry = AppRegistry()
    if args.app_list == 'full':
        for app_list_file in APP_LISTS_DIR.glob('*.txt'):
            app_registry.register_from_txt(app_list_file)
    else:
        app_registry.register_from_txt(APP_LISTS_DIR / f"{args.app_list}.txt")
    to_install = []
    for app in app_registry.iterate_apps():
        if app.is_installed() and not args.force_reinstall:
            print(f"[INFO] Skipping already installed app: {app.name} ({app.command})")
            continue
        to_install.append(app.name)
    print("[INFO] Total apps to install:", len(to_install))
    print("[INFO] App to install:", to_install)
    # --- set manager ---
    if args.custom_bin_path is not None and mode == 'miniforge':
        custom_bin_path = Path(args.custom_bin_path)
        manager = PACKAGE_MANAGER_REGISTRY.get_manager('miniforge')(context=env_ctx, name=mode, custom_bin_path=custom_bin_path) # pyright: ignore[reportCallIssue]
    else:
        manager = PACKAGE_MANAGER_REGISTRY.get_manager(mode)(context=env_ctx, name=mode)

    manager.ensure_available()
    manager.install_package(packages_list=to_install, force_reinstall=args.force_reinstall)

if __name__ == "__main__":
    main()
