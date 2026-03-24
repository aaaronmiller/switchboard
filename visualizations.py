#!/usr/bin/env python3
"""
Terminal visualizations for Switchboard metrics
Creates beautiful ASCII/Unicode charts without external dependencies
"""

from metrics import get_metrics
from datetime import datetime

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
}

# Unicode sparkline characters
SPARKLINE = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█']
BAR = '█'
EMPTY = '░'


class MetricsVisualizer:
    """Render metrics as beautiful terminal visualizations"""

    def __init__(self, metrics: dict):
        self.metrics = metrics
        self.width = 60

    def render_dashboard(self) -> str:
        """Full metrics dashboard"""
        if 'error' in self.metrics:
            return f"{COLORS['red']}Error: {self.metrics['error']}{COLORS['reset']}"

        output = []
        output.append(self._render_header())
        output.append(self._render_agent_usage())
        output.append(self._render_timeline())
        output.append(self._render_patterns())
        output.append(self._render_streaks())
        output.append(self._render_footer())

        return '\n'.join(output)

    def _render_header(self) -> str:
        """Dashboard header"""
        header = f"""
{COLORS['cyan']}╔═══════════════════════════════════════════════════════╗
║{COLORS['bold']}       YOUR AI CODING METRICS DASHBOARD{COLORS['reset']}{COLORS['cyan']}               ║
╚═══════════════════════════════════════════════════════╝{COLORS['reset']}
"""
        return header

    def _render_agent_usage(self) -> str:
        """Agent usage pie chart"""
        output = [f"\n{COLORS['bold']}Agent Usage (Last 30 Days){COLORS['reset']}\n"]

        usage = self.metrics.get('agent_usage', {})
        if not usage:
            return "No agent usage data found"

        # Color mapping
        agent_colors = {
            'claude': COLORS['magenta'],
            'codex': COLORS['green'],
            'qwen': COLORS['blue'],
            'gemini': COLORS['cyan'],
            'kimi': COLORS['yellow'],
        }

        total = sum(u['count'] for u in usage.values())

        for agent, stats in usage.items():
            color = agent_colors.get(agent, COLORS['white'])
            percentage = stats['percentage']
            count = stats['count']

            # Bar chart
            bar_length = int(percentage / 2)  # Scale to 50 chars max
            bar = BAR * bar_length + EMPTY * (50 - bar_length)

            output.append(
                f"  {color}{agent.capitalize():<12}{COLORS['reset']} "
                f"{bar} {percentage:>5.1f}% ({count} sessions)"
            )

        return '\n'.join(output)

    def _render_timeline(self) -> str:
        """Activity timeline with sparklines"""
        output = [f"\n{COLORS['bold']}7-Day Activity Trend{COLORS['reset']}\n"]

        timeline = self.metrics.get('timeline', {})
        last_7 = timeline.get('last_7_days', [])

        if not last_7:
            return "No timeline data"

        # Normalize to sparkline scale
        counts = [d['count'] for d in last_7]
        max_count = max(counts) if counts else 1

        sparkline_str = ""
        for day in last_7:
            if max_count > 0:
                idx = int((day['count'] / max_count) * (len(SPARKLINE) - 1))
            else:
                idx = 0
            sparkline_str += SPARKLINE[idx]

        # Display with day labels
        output.append("  " + " ".join(d['day'] for d in last_7))
        output.append("  " + " ".join(sparkline_str))

        # Peak hour
        peak_hour = timeline.get('peak_hour')
        if peak_hour is not None:
            output.append(f"\n  {COLORS['yellow']}Peak Hour: {peak_hour:02d}:00{COLORS['reset']}")

        return '\n'.join(output)

    def _render_patterns(self) -> str:
        """Usage patterns and insights"""
        output = [f"\n{COLORS['bold']}Coding Patterns{COLORS['reset']}\n"]

        patterns = self.metrics.get('patterns', {})
        loyalty = patterns.get('loyalty_score', 'Unknown')
        switches = patterns.get('agent_switches', 0)
        avg_session = patterns.get('average_session_minutes', 0)

        output.append(f"  {COLORS['cyan']}Loyalty Score{COLORS['reset']}: {loyalty}")
        output.append(f"  {COLORS['yellow']}Agent Switches{COLORS['reset']}: {switches} times")
        output.append(f"  {COLORS['green']}Avg Session${COLORS['reset']}: {avg_session:.0f} minutes")

        return '\n'.join(output)

    def _render_streaks(self) -> str:
        """Activity streaks"""
        output = [f"\n{COLORS['bold']}Streaks & Milestones{COLORS['reset']}\n"]

        streaks = self.metrics.get('streaks', {})
        current = streaks.get('current_streak', 0)
        longest = streaks.get('longest_streak', 0)

        # Current streak with fire emoji
        if current > 0:
            fire = '🔥' if current >= 3 else '✓'
            output.append(f"  {COLORS['red']}Current Streak{COLORS['reset']}: {current} days {fire}")
        else:
            output.append(f"  {COLORS['dim']}Current Streak{COLORS['reset']}: {current} days (start coding!)")

        # Longest streak
        output.append(f"  {COLORS['magenta']}Best Streak{COLORS['reset']}: {longest} days 🏆")

        return '\n'.join(output)

    def _render_footer(self) -> str:
        """Footer with last updated"""
        updated = self.metrics.get('last_updated', 'unknown')
        return f"\n{COLORS['dim']}Last updated: {updated}{COLORS['reset']}\n"

    def render_quick_stats(self) -> str:
        """One-line quick summary for launcher header"""
        usage = self.metrics.get('agent_usage', {})
        if not usage:
            return "No metrics available yet"

        top_agent = list(usage.keys())[0]
        top_count = usage[top_agent]['count']
        loyalty = self.metrics.get('patterns', {}).get('loyalty_score', 'Unknown')

        return f"{COLORS['cyan']}📊 {top_count} sessions with {top_agent.capitalize()} • {loyalty}{COLORS['reset']}"


def print_dashboard():
    """Print full metrics dashboard"""
    metrics = get_metrics()
    viz = MetricsVisualizer(metrics)
    print(viz.render_dashboard())


def get_quick_stats() -> str:
    """Get quick stats for launcher display"""
    try:
        metrics = get_metrics()
        viz = MetricsVisualizer(metrics)
        return viz.render_quick_stats()
    except Exception:
        return ""


if __name__ == "__main__":
    print_dashboard()
