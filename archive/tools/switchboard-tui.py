#!/usr/bin/env python3
"""
Switchboard Launcher - Color-coded TUI for AI CLI tools
Launches Claude Code, Codex, Qwen, and more with proxy support

Integrates with ccproxy (~8082) and CLIProxyAPI for arbitrary endpoint routing
Includes metrics dashboard showing your coding patterns
"""

import os
import sys
import subprocess
import json
import socket
from pathlib import Path
from dataclasses import dataclass, field
from typing import Optional, Dict

# Try to import metrics visualizations (optional)
try:
    from visualizations import get_quick_stats, MetricsVisualizer
    from metrics import get_metrics
    METRICS_AVAILABLE = True
except ImportError:
    METRICS_AVAILABLE = False

# ANSI Colors
COLORS = {
    'reset': '\033[0m',
    'bold': '\033[1m',
    'dim': '\033[2m',
    'red': '\033[91m',
    'green': '\033[92m',
    'yellow': '\033[93m',
    'blue': '\033[94m',
    'magenta': '\033[95m',
    'cyan': '\033[96m',
    'white': '\033[97m',
    'gray': '\033[90m',
    'orange': '\033[38;5;208m',
    'pink': '\033[38;5;213m',
    'teal': '\033[38;5;51m',
}

# Proxy paths
PROXY_DIR = Path.home() / "code" / "claude-code-proxy"
PROXY_ENV = PROXY_DIR / ".env"
PROXY_ENVRC = PROXY_DIR / ".envrc"
CLIPROXY_DIR = Path.home() / "code" / "cliproxyapi"

@dataclass
class Agent:
    """AI CLI Agent configuration"""
    name: str
    command: list
    color: str
    description: str
    category: str = "main"
    proxy_support: bool = True
    installed: bool = True
    env_overrides: Dict[str, str] = field(default_factory=dict)

# Pre-configured agents (auto-detection runs after)
AGENTS_REGISTRY = [
    # MAIN AGENTS (Direct, no proxy)
    Agent(
        name="Claude Code",
        command=["claude"],
        color=COLORS['magenta'],
        description="Anthropic's official CLI coding agent",
        category="main",
        proxy_support=True
    ),
    Agent(
        name="Codex",
        command=["codex"],
        color=COLORS['green'],
        description="OpenAI's terminal coding agent",
        category="main",
        proxy_support=True
    ),
    Agent(
        name="Qwen Code",
        command=["qwen"],
        color=COLORS['blue'],
        description="Alibaba's Qwen3-Coder optimized CLI",
        category="main",
        proxy_support=True
    ),
    # PROXY AGENTS (Via ccproxy on port 8082)
    Agent(
        name="Claude (via ccproxy)",
        command=["claude"],
        color=COLORS['pink'],
        description="Claude Code routed through ccproxy",
        category="proxy",
        proxy_support=False,
        env_overrides={
            "ANTHROPIC_BASE_URL": "http://localhost:8082",
            "ANTHROPIC_API_KEY": "pass"
        }
    ),
    Agent(
        name="Codex (via ccproxy)",
        command=["codex"],
        color=COLORS['yellow'],
        description="Codex routed through ccproxy",
        category="proxy",
        proxy_support=False,
        env_overrides={
            "OPENAI_BASE_URL": "http://localhost:8082"
        }
    ),
    Agent(
        name="Qwen (via ccproxy)",
        command=["qwen"],
        color=COLORS['teal'],
        description="Qwen Code routed through ccproxy",
        category="proxy",
        proxy_support=False,
        env_overrides={
            "DASHSCOPE_BASE_URL": "http://localhost:8082"
        }
    ),
]

CONFIG_DIR = Path.home() / ".switchboard"
CONFIG_FILE = CONFIG_DIR / "config.json"

def detect_proxy_port() -> str:
    """Auto-detect ccproxy port from config files or running process"""
    # Try .env first
    if PROXY_ENV.exists():
        try:
            with open(PROXY_ENV) as f:
                for line in f:
                    if line.startswith('PORT='):
                        port = line.split('=')[1].strip()
                        return f"http://localhost:{port}"
        except Exception:
            pass

    # Try .envrc
    if PROXY_ENVRC.exists():
        try:
            with open(PROXY_ENVRC) as f:
                content = f.read()
                if 'start_proxy.py' in content:
                    for port in ['8082', '8317', '8940']:
                        if is_port_open(port):
                            return f"http://localhost:{port}"
        except Exception:
            pass

    # Check running process
    try:
        result = subprocess.run(['pgrep', '-f', 'start_proxy.py'],
                              capture_output=True, text=True)
        if result.returncode == 0:
            for port in ['8082', '8317', '8940']:
                if is_port_open(port):
                    return f"http://localhost:{port}"
    except Exception:
        pass

    # Default fallback
    return "http://localhost:8082"

def is_port_open(port: str) -> bool:
    """Check if a port is reachable"""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.settimeout(0.5)
            return sock.connect_ex(('localhost', int(port))) == 0
    except Exception:
        return False

def check_agent_installed(agent: Agent) -> bool:
    """Verify agent command is available"""
    try:
        result = subprocess.run(
            ["which", agent.command[0]],
            capture_output=True, text=True, timeout=2
        )
        return result.returncode == 0
    except Exception:
        return False

def detect_installed_agents(agents: list) -> list:
    """Mark which agents are actually installed"""
    for agent in agents:
        agent.installed = check_agent_installed(agent)
    return agents

def ensure_config():
    """Create ~/.switchboard/config.json if missing"""
    CONFIG_DIR.mkdir(exist_ok=True, parents=True)
    if not CONFIG_FILE.exists():
        default = {
            "proxy_url": detect_proxy_port(),
            "default_agent": "Claude Code",
            "custom_agents": [],
            "theme": "default"
        }
        CONFIG_FILE.write_text(json.dumps(default, indent=2))

def load_config() -> dict:
    """Load configuration"""
    ensure_config()
    return json.loads(CONFIG_FILE.read_text())

def save_config(config: dict):
    """Save configuration"""
    ensure_config()
    CONFIG_FILE.write_text(json.dumps(config, indent=2))

def print_banner(show_metrics=False):
    """Print colorful banner"""
    banner = f"""
{COLORS['cyan']}╔═══════════════════════════════════════════════════╗
║{COLORS['bold']}  ⚓ SWITCHBOARD LAUNCHER{COLORS['reset']}{COLORS['cyan']}                      ║
║  {COLORS['dim']}AI CLI Multiplexer & Proxy Router{COLORS['reset']}{COLORS['cyan']}              ║
╚═══════════════════════════════════════════════════╝{COLORS['reset']}
"""
    print(banner)

    # Show quick metrics if available
    if show_metrics and METRICS_AVAILABLE:
        try:
            quick_stats = get_quick_stats()
            if quick_stats:
                print(f"\n{quick_stats}\n")
        except Exception:
            pass


def show_metrics_dashboard():
    """Display full metrics dashboard"""
    if not METRICS_AVAILABLE:
        print(f"{COLORS['red']}Metrics not available (missing dependencies){COLORS['reset']}")
        return

    try:
        metrics = get_metrics()
        viz = MetricsVisualizer(metrics)
        print(viz.render_dashboard())
    except Exception as e:
        print(f"{COLORS['red']}Error loading metrics: {e}{COLORS['reset']}")


def print_help():
    """Print help and usage"""
    help_text = f"""
{COLORS['cyan']}SWITCHBOARD LAUNCHER{COLORS['reset']} - AI CLI Multiplexer & Proxy Router

{COLORS['bold']}USAGE{COLORS['reset']}
  switchboard                 Start interactive agent selector
  switchboard --metrics       Show coding metrics dashboard
  switchboard --help          Show this help
  switchboard --version       Show version

{COLORS['bold']}COMMANDS{COLORS['reset']} (in interactive mode)
  [1-9]                       Select agent
  c                           Configuration menu
  r                           Refresh agent list
  q                           Quit

{COLORS['bold']}CONFIGURATION{COLORS['reset']}
  Config file: ~/.switchboard/config.json
  Metrics cache: ~/.switchboard/metrics.json
  Proxy detection: Auto-detects ccproxy on port 8082

{COLORS['bold']}EXAMPLES{COLORS['reset']}
  # Launch Claude Code
  switchboard
  [Select 1]

  # See your coding metrics
  switchboard --metrics

  # Add alias to zshrc
  echo "alias switchboard='python3 ~/code/switchboard-launcher/switchboard.py'" >> ~/.zshrc

{COLORS['bold']}FEATURES{COLORS['reset']}
  ✓ Auto-detects installed CLI tools
  ✓ Color-coded agent organization
  ✓ Proxy routing via ccproxy
  ✓ Persistent configuration
  ✓ Coding metrics & visualizations
  ✓ Custom agent support

{COLORS['dim']}For issues: https://github.com/aaaronmiller/switchboard{COLORS['reset']}
"""
    print(help_text)

def print_agents(agents: list, config: dict):
    """Display agents grouped by category with install status"""
    print(f"\n{COLORS['bold']}Available Agents:{COLORS['reset']}\n")

    # Group by category
    by_category = {}
    for agent in agents:
        if agent.category not in by_category:
            by_category[agent.category] = []
        by_category[agent.category].append(agent)

    category_headers = {
        "main": f"{COLORS['green']}▸ MAIN AGENTS{COLORS['reset']}",
        "proxy": f"{COLORS['yellow']}▸ PROXY AGENTS (via ccproxy){COLORS['reset']}",
        "custom": f"{COLORS['magenta']}▸ CUSTOM AGENTS{COLORS['reset']}"
    }

    for category in ["main", "proxy", "custom"]:
        if category not in by_category or not by_category[category]:
            continue

        print(f"  {category_headers.get(category, category)}")
        print(f"  {COLORS['gray']}{'─' * 46}{COLORS['reset']}")

        for i, agent in enumerate(by_category[category], 1):
            status = f"{COLORS['green']}✓{COLORS['reset']}" if agent.installed else f"{COLORS['red']}✗{COLORS['reset']}"
            color = agent.color if agent.installed else COLORS['gray']
            name_fmt = f"{color}{agent.name:<26}{COLORS['reset']}"
            desc = f"{COLORS['dim']}{agent.description}{COLORS['reset']}" if agent.installed else f"{COLORS['gray']}{agent.description}{COLORS['reset']}"
            print(f"    {status} {name_fmt} {desc}")

        print()

def launch_agent(agent: Agent, use_proxy: bool = False, custom_proxy: str = None):
    """Execute agent CLI with environment overrides"""
    print(f"\n{COLORS['cyan']}→ Launching {agent.name}...{COLORS['reset']}\n")

    env = os.environ.copy()

    # Apply env overrides
    if agent.env_overrides:
        env.update(agent.env_overrides)
        if "http://localhost" in str(agent.env_overrides.values()):
            proxy_url = list(agent.env_overrides.values())[0]
            print(f"{COLORS['yellow']}  Proxy: {proxy_url}{COLORS['reset']}")

    # Custom proxy override
    if use_proxy and custom_proxy:
        # Detect agent type and set appropriate env var
        if "Claude" in agent.name or "claude" in agent.command[0]:
            env["ANTHROPIC_BASE_URL"] = custom_proxy
            env["ANTHROPIC_API_KEY"] = "pass"
        elif "Codex" in agent.name or "codex" in agent.command[0]:
            env["OPENAI_BASE_URL"] = custom_proxy
        elif "Qwen" in agent.name or "qwen" in agent.command[0]:
            env["DASHSCOPE_BASE_URL"] = custom_proxy

    try:
        subprocess.run(agent.command, env=env)
    except KeyboardInterrupt:
        print(f"\n{COLORS['yellow']}Interrupted{COLORS['reset']}")
    except FileNotFoundError:
        print(f"{COLORS['red']}✗ Error: {agent.command[0]} not found{COLORS['reset']}")

def show_menu(agents: list, config: dict):
    """Interactive selection loop"""
    while True:
        print(f"\n{COLORS['bold']}Select agent:{COLORS['reset']}")
        print(f"  {COLORS['dim']}(q=quit, c=config, r=refresh){COLORS['reset']}\n")

        installed = [a for a in agents if a.installed]
        for i, agent in enumerate(installed, 1):
            print(f"  {agent.color}[{i}]{COLORS['reset']} {agent.name}")

        print()
        choice = input(f"{COLORS['green']}>{COLORS['reset']} ").strip().lower()

        if choice == 'q':
            print(f"\n{COLORS['cyan']}Fair winds! ⚓{COLORS['reset']}\n")
            break
        elif choice == 'c':
            config_menu(agents, config)
        elif choice == 'r':
            agents = detect_installed_agents(agents)
            print(f"{COLORS['green']}✓ Refreshed{COLORS['reset']}")
        elif choice.isdigit():
            idx = int(choice) - 1
            if 0 <= idx < len(installed):
                agent = installed[idx]

                # Proxy prompt for non-proxy agents
                use_proxy = False
                if agent.category == "main" and agent.proxy_support:
                    resp = input(f"{COLORS['yellow']}Route via proxy? (y/n): {COLORS['reset']}").strip().lower()
                    use_proxy = (resp == 'y')

                launch_agent(agent, use_proxy, config.get('proxy_url'))
            else:
                print(f"{COLORS['red']}Invalid{COLORS['reset']}")

def config_menu(agents: list, config: dict):
    """Configuration editor"""
    while True:
        print(f"\n{COLORS['bold']}Config:{COLORS['reset']}")
        print(f"  1. Proxy URL (current: {config.get('proxy_url', 'auto')})")
        print(f"  2. Add custom agent")
        print(f"  3. Back")

        choice = input(f"{COLORS['green']}>{COLORS['reset']} ").strip()

        if choice == '1':
            url = input("Proxy URL: ").strip()
            config['proxy_url'] = url
            save_config(config)
            print(f"{COLORS['green']}✓ Updated{COLORS['reset']}")
        elif choice == '2':
            add_custom_agent(agents, config)
        elif choice == '3':
            break

def add_custom_agent(agents: list, config: dict):
    """Add custom agent to config"""
    print("\n{COLORS['bold']}New custom agent:{COLORS['reset']}")
    name = input("  Name: ").strip()
    cmd = input("  Command: ").strip()
    desc = input("  Description: ").strip()
    color_name = input("  Color (green/blue/cyan/magenta/yellow/red): ").strip().lower()

    color_map = {
        'red': COLORS['red'], 'green': COLORS['green'],
        'blue': COLORS['blue'], 'cyan': COLORS['cyan'],
        'magenta': COLORS['magenta'], 'yellow': COLORS['yellow']
    }

    color = color_map.get(color_name, COLORS['white'])

    custom = {
        "name": name,
        "command": cmd.split(),
        "color": color,
        "description": desc,
        "category": "custom"
    }

    config.setdefault('custom_agents', []).append(custom)
    save_config(config)
    print(f"{COLORS['green']}✓ Added{COLORS['reset']}")

def main():
    """Entry point"""
    # Handle command-line arguments
    if len(sys.argv) > 1:
        arg = sys.argv[1].lower()

        if arg == '--metrics' or arg == '-m':
            show_metrics_dashboard()
            return
        elif arg == '--help' or arg == '-h':
            print_help()
            return
        elif arg == '--version' or arg == '-v':
            print("Switchboard Launcher v1.0")
            return

    config = load_config()
    agents = detect_installed_agents(AGENTS_REGISTRY.copy())

    # Load custom agents from config
    for custom in config.get('custom_agents', []):
        agents.append(Agent(
            name=custom['name'],
            command=custom['command'],
            color=custom.get('color', COLORS['white']),
            description=custom['description'],
            category=custom.get('category', 'custom')
        ))

    print_banner(show_metrics=True)
    print_agents(agents, config)
    show_menu(agents, config)

if __name__ == "__main__":
    main()
