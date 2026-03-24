#!/usr/bin/env python3
"""
Switchboard Launcher - Color-coded TUI for AI CLI tools
Launches Claude Code, Codex, Qwen, Gemini, Kimi, and more with proxy support

Integrates with ccproxy for arbitrary endpoint routing
"""

import os
import sys
import subprocess
import json
import re
from pathlib import Path
from dataclasses import dataclass
from typing import Optional

# Colors for agents
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

# Proxy configuration paths
PROXY_DIR = Path.home() / "code" / "claude-code-proxy"
PROXY_ENV = PROXY_DIR / ".env"
PROXY_ENVRC = PROXY_DIR / ".envrc"

@dataclass
class Agent:
    name: str
    command: list[str]
    color: str
    description: str
    proxy_support: bool = True
    installed: bool = True
    category: str = "main"

# Agent definitions with color coding
AGENTS = [
    Agent(
        name="Claude Code",
        command=["claude"],
        color=COLORS['magenta'],
        description="Anthropic's official CLI coding agent",
        proxy_support=True,
        category="main"
    ),
    Agent(
        name="Codex",
        command=["codex"],
        color=COLORS['green'],
        description="OpenAI's terminal coding agent",
        proxy_support=True,
        category="main"
    ),
    Agent(
        name="Qwen Code",
        command=["qwen"],
        color=COLORS['blue'],
        description="Alibaba's Qwen3-Coder optimized CLI",
        proxy_support=True,
        category="main"
    ),
    Agent(
        name="Gemini CLI",
        command=["gemini"],
        color=COLORS['cyan'],
        description="Google's Gemini coding assistant",
        proxy_support=True,
        category="main"
    ),
    Agent(
        name="Kimi Code",
        command=["kimi"],
        color=COLORS['orange'],
        description="Moonshot AI's Kimi coding agent",
        proxy_support=True,
        category="main"
    ),
    Agent(
        name="OpenRouter",
        command=["openrouter"],
        color=COLORS['teal'],
        description="OpenRouter multi-model CLI",
        proxy_support=True,
        category="proxy"
    ),
    Agent(
        name="Claude (w/ Proxy)",
        command=["claude"],
        color=COLORS['pink'],
        description="Claude Code via ccproxy",
        proxy_support=True,
        category="proxy",
        env={"ANTHROPIC_BASE_URL": "http://localhost:8940", "ANTHROPIC_API_KEY": "any-value"}
    ),
    Agent(
        name="Codex (w/ Proxy)",
        command=["codex"],
        color=COLORS['yellow'],
        description="Codex via custom endpoint",
        proxy_support=True,
        category="proxy",
        env={"OPENAI_BASE_URL": "http://localhost:8940"}
    ),
    Agent(
        name="Qwen (w/ Proxy)",
        command=["qwen"],
        color=COLORS['blue'],
        description="Qwen Code via custom endpoint",
        proxy_support=True,
        category="proxy",
        env={"DASHSCOPE_API_KEY": "any-value"}
    ),
]

CONFIG_DIR = Path.home() / ".switchboard"
CONFIG_FILE = CONFIG_DIR / "config.json"

def detect_proxy_port() -> str:
    """Detect the proxy port from ccproxy config"""
    # Try .envrc first, then .env
    for env_file in [PROXY_ENVRC, PROXY_ENV]:
        if env_file.exists():
            try:
                content = env_file.read_text()
                # Look for PORT= or HOST= settings
                for line in content.split('\n'):
                    if line.startswith('PORT='):
                        port = line.split('=')[1].strip()
                        return f"http://localhost:{port}"
                # Check for start_proxy.py command line
                if 'start_proxy.py' in content:
                    # Try to find port in running process
                    result = subprocess.run(
                        ['pgrep', '-f', 'start_proxy.py'],
                        capture_output=True, text=True
                    )
                    if result.returncode == 0:
                        # Process is running, check common ports
                        for p in ['8082', '8940', '8317']:
                            if is_port_open(p):
                                return f"http://localhost:{p}"
            except Exception:
                pass
    
    # Default fallback
    return "http://localhost:8082"

def is_port_open(port: str) -> bool:
    """Check if a port is open"""
    import socket
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(1)
        result = sock.connect_ex(('localhost', int(port)))
        sock.close()
        return result == 0
    except Exception:
        return False

def ensure_config():
    """Create config directory and default config if needed"""
    CONFIG_DIR.mkdir(exist_ok=True)
    if not CONFIG_FILE.exists():
        default_config = {
            "proxy_url": detect_proxy_port(),
            "default_agent": "Claude Code",
            "show_categories": True,
            "custom_agents": [],
            "proxy_dir": str(PROXY_DIR)
        }
        with open(CONFIG_FILE, 'w') as f:
            json.dump(default_config, f, indent=2)
    return CONFIG_FILE

def load_config():
    """Load user configuration"""
    ensure_config()
    with open(CONFIG_FILE, 'r') as f:
        return json.load(f)

def save_config(config):
    """Save user configuration"""
    ensure_config()
    with open(CONFIG_FILE, 'w') as f:
        json.dump(config, f, indent=2)

def check_agent_installed(agent: Agent) -> bool:
    """Check if an agent CLI is installed"""
    try:
        result = subprocess.run(
            ["which", agent.command[0]],
            capture_output=True,
            text=True,
            timeout=5
        )
        return result.returncode == 0
    except Exception:
        return False

def detect_installed_agents():
    """Auto-detect which agents are installed"""
    for agent in AGENTS:
        agent.installed = check_agent_installed(agent)
    return AGENTS

def print_banner():
    """Print the switchboard banner"""
    banner = f"""
{COLORS['cyan']}╔══════════════════════════════════════════════════════════╗
║{COLORS['bold']}  SWITCHBOARD LAUNCHER{COLORS['reset']}{COLORS['cyan']}                              ║
║  {COLORS['dim']}AI CLI Multiplexer & Proxy Manager{COLORS['reset']}{COLORS['cyan']}                 ║
╚══════════════════════════════════════════════════════════╝{COLORS['reset']}
"""
    print(banner)

def print_agent_list(agents: list[Agent], config: dict):
    """Print color-coded agent list"""
    print(f"\n{COLORS['bold']}Available Agents:{COLORS['reset']}\n")
    
    categories = {}
    for agent in agents:
        if agent.category not in categories:
            categories[agent.category] = []
        categories[agent.category].append(agent)
    
    category_names = {
        "main": f"{COLORS['green']}MAIN AGENTS{COLORS['reset']}",
        "proxy": f"{COLORS['yellow']}PROXY AGENTS{COLORS['reset']}",
        "custom": f"{COLORS['magenta']}CUSTOM AGENTS{COLORS['reset']}"
    }
    
    for category, cat_agents in categories.items():
        if not cat_agents:
            continue
        
        print(f"  {category_names.get(category, category)}")
        print(f"  {'─' * 50}")
        
        for i, agent in enumerate(cat_agents, 1):
            status = f"{COLORS['green']}✓{COLORS['reset']}" if agent.installed else f"{COLORS['red']}✗{COLORS['reset']}"
            color = agent.color if agent.installed else COLORS['gray']
            
            # Pad the name for alignment
            name_padded = f"{agent.name:<25}"
            
            print(f"    {status} {color}{name_padded}{COLORS['reset']} {COLORS['dim']}- {agent.description}{COLORS['reset']}")
        
        print()

def launch_agent(agent: Agent, use_proxy: bool = False, proxy_url: str = None):
    """Launch an agent with optional proxy configuration"""
    print(f"\n{COLORS['cyan']}Launching {agent.name}...{COLORS['reset']}\n")
    
    env = os.environ.copy()
    
    # Apply proxy settings if requested
    if use_proxy and proxy_url and agent.proxy_support:
        if "Anthropic" in agent.description or agent.name.startswith("Claude"):
            env["ANTHROPIC_BASE_URL"] = proxy_url
            env["ANTHROPIC_API_KEY"] = "proxy-key"
            print(f"{COLORS['yellow']}→ Proxy: {proxy_url}{COLORS['reset']}")
        elif "OpenAI" in agent.description or agent.name.startswith("Codex"):
            env["OPENAI_BASE_URL"] = proxy_url
            print(f"{COLORS['yellow']}→ Proxy: {proxy_url}{COLORS['reset']}")
        elif "Qwen" in agent.description or "DashScope" in agent.description:
            env["DASHSCOPE_BASE_URL"] = proxy_url
            print(f"{COLORS['yellow']}→ Proxy: {proxy_url}{COLORS['reset']}")
    
    # Apply agent-specific env overrides
    if hasattr(agent, 'env') and agent.env:
        env.update(agent.env)
    
    try:
        subprocess.run(agent.command, env=env)
    except KeyboardInterrupt:
        print(f"\n{COLORS['yellow']}Agent stopped{COLORS['reset']}")
    except FileNotFoundError:
        print(f"{COLORS['red']}Error: {agent.command[0]} not found. Please install it first.{COLORS['reset']}")
        return False
    
    return True

def interactive_menu(agents: list[Agent], config: dict):
    """Show interactive selection menu"""
    while True:
        print(f"\n{COLORS['bold']}Select an agent:{COLORS['reset']}")
        print(f"  {COLORS['dim']}Enter number, 'q' to quit, 'c' for config, 'r' to refresh{COLORS['reset']}")
        print()
        
        installed = [a for a in agents if a.installed]
        
        for i, agent in enumerate(installed, 1):
            color = agent.color
            print(f"  {color}[{i}]{COLORS['reset']} {agent.name}")
        
        print()
        
        try:
            choice = input(f"{COLORS['green']}>{COLORS['reset']} ").strip().lower()
            
            if choice == 'q':
                print(f"\n{COLORS['cyan']}Fair winds and following seas! ⚓{COLORS['reset']}\n")
                break
            elif choice == 'c':
                show_config_menu(config)
            elif choice == 'r':
                agents = detect_installed_agents()
                print(f"{COLORS['green']}✓ Refreshed agent list{COLORS['reset']}")
            elif choice.isdigit():
                idx = int(choice) - 1
                if 0 <= idx < len(installed):
                    agent = installed[idx]
                    
                    # Ask about proxy
                    if agent.proxy_support:
                        proxy_choice = input(f"{COLORS['yellow']}Use proxy? (y/n/{COLORS['reset']}): ").strip().lower()
                        use_proxy = proxy_choice == 'y'
                        proxy_url = config.get('proxy_url') if use_proxy else None
                    else:
                        use_proxy = False
                        proxy_url = None
                    
                    launch_agent(agent, use_proxy, proxy_url)
                else:
                    print(f"{COLORS['red']}Invalid selection{COLORS['reset']}")
            else:
                print(f"{COLORS['red']}Unknown command{COLORS['reset']}")
                
        except KeyboardInterrupt:
            print(f"\n{COLORS['yellow']}Interrupted{COLORS['reset']}")
            break
        except EOFError:
            break

def show_config_menu(config: dict):
    """Show configuration menu"""
    while True:
        print(f"\n{COLORS['bold']}Configuration:{COLORS['reset']}")
        print(f"  1. Set proxy URL (current: {config.get('proxy_url', 'none')})")
        print(f"  2. Set default agent")
        print(f"  3. Add custom agent")
        print(f"  4. Back")
        
        try:
            choice = input(f"{COLORS['green']}>{COLORS['reset']} ").strip()
            
            if choice == '1':
                new_url = input(f"Proxy URL: ").strip()
                config['proxy_url'] = new_url
                save_config(config)
                print(f"{COLORS['green']}✓ Proxy URL updated{COLORS['reset']}")
            elif choice == '2':
                print("Default agent: ", end='')
                config['default_agent'] = input().strip()
                save_config(config)
                print(f"{COLORS['green']}✓ Default agent updated{COLORS['reset']}")
            elif choice == '3':
                add_custom_agent(config)
            elif choice == '4':
                break
        except (KeyboardInterrupt, EOFError):
            break

def add_custom_agent(config: dict):
    """Add a custom agent to config"""
    print("\nAdding custom agent:")
    name = input("  Name: ").strip()
    command = input("  Command: ").strip()
    color_code = input("  Color (red/green/blue/yellow/magenta/cyan): ").strip().lower()
    description = input("  Description: ").strip()
    
    color_map = {
        'red': COLORS['red'],
        'green': COLORS['green'],
        'blue': COLORS['blue'],
        'yellow': COLORS['yellow'],
        'magenta': COLORS['magenta'],
        'cyan': COLORS['cyan'],
    }
    color = color_map.get(color_code, COLORS['white'])
    
    custom = {
        "name": name,
        "command": command.split(),
        "color": color,
        "description": description,
        "category": "custom"
    }
    
    config.setdefault('custom_agents', []).append(custom)
    save_config(config)
    print(f"{COLORS['green']}✓ Custom agent added{COLORS['reset']}")

def main():
    """Main entry point"""
    config = load_config()
    agents = detect_installed_agents()
    
    print_banner()
    print_agent_list(agents, config)
    interactive_menu(agents, config)

if __name__ == "__main__":
    main()
