from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable

@dataclass
class App:
    name: str
    command: str = field(default="", init=False)

    def __post_init__(self):
        """初始化后自动设置命令名"""
        if not self.command:
            self.command = self._get_command_name()

    def _get_command_name(self) -> str:
        """Derive the command name from the app name."""
        command_dict = {
            'neovim': 'nvim',
        }
        command_name: str = self.name.lower().replace(" ", "-")
        if self.name.lower() in command_dict:
            command_name = command_dict[self.name.lower()]
        return command_name

    def is_installed(self) -> bool:
        """Check if the app is installed by verifying if the command exists in PATH."""
        from shutil import which
        return which(self.command) is not None

class AppRegistry:
    def __init__(self) -> None:
        self._registry: dict[str, App] = {}

    def register(self, app: App) -> None:
        self._registry[app.name] = app

    def register_from_txt(self, file_path: Path) -> None:
        app_names = [app.strip() for app in file_path.read_text().splitlines() if app.strip() and not app.startswith('#')]
        for name in app_names:
            app = App(name=name)
            self.register(app)

    def get_app(self, name: str) -> App:
        if name not in self._registry:
            raise ValueError(f"App '{name}' is not registered.")
        return self._registry[name]

    def iterate_apps(self) -> Iterable[App]:
        for app in self._registry.values():
            yield app
