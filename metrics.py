#!/usr/bin/env python3
"""
Switchboard Metrics - Analyze your AI CLI coding patterns
Extracts data from shell history, calculates trends, visualizes usage
"""

import json
import re
from pathlib import Path
from datetime import datetime, timedelta
from collections import defaultdict, Counter
import statistics

HISTORY_FILE = Path.home() / ".zsh_history"
METRICS_FILE = Path.home() / ".switchboard" / "metrics.json"
CACHE_HOURS = 24

class MetricsCollector:
    """Extract and analyze CLI usage from shell history"""

    def __init__(self):
        self.metrics = self._load_cached_metrics()
        self.history_entries = []
        self.cli_invocations = defaultdict(list)

    def _load_cached_metrics(self) -> dict:
        """Load cached metrics if recent"""
        if METRICS_FILE.exists():
            try:
                with open(METRICS_FILE) as f:
                    cached = json.load(f)
                    timestamp = datetime.fromisoformat(cached.get('last_updated', '1970-01-01'))
                    age_hours = (datetime.now() - timestamp).total_seconds() / 3600
                    if age_hours < CACHE_HOURS:
                        return cached
            except Exception:
                pass
        return {'last_updated': datetime.now().isoformat()}

    def analyze(self) -> dict:
        """Analyze shell history and return metrics"""
        if not HISTORY_FILE.exists():
            return {'error': 'No shell history found'}

        # Parse zsh history format: ": timestamp:0;command"
        self._parse_history()

        # Calculate metrics
        metrics = {
            'last_updated': datetime.now().isoformat(),
            'total_entries': len(self.history_entries),
            'agent_usage': self._calculate_agent_usage(),
            'timeline': self._calculate_timeline(),
            'patterns': self._calculate_patterns(),
            'streaks': self._calculate_streaks(),
        }

        # Save cache
        self._save_metrics(metrics)
        return metrics

    def _parse_history(self):
        """Parse zsh history file"""
        with open(HISTORY_FILE, 'r', errors='ignore') as f:
            for line in f:
                # zsh format: ": timestamp:0;command"
                match = re.match(r'^:\s*(\d+):0;(.+)$', line.strip())
                if match:
                    timestamp = int(match.group(1))
                    command = match.group(2)

                    try:
                        dt = datetime.fromtimestamp(timestamp)
                        self.history_entries.append({
                            'timestamp': dt,
                            'command': command,
                            'hour': dt.hour,
                            'day': dt.strftime('%A'),
                            'date': dt.date()
                        })

                        # Track CLI invocations
                        for cli in ['claude', 'codex', 'qwen', 'gemini', 'kimi']:
                            if cli in command.lower():
                                self.cli_invocations[cli].append(dt)
                    except (ValueError, OSError):
                        pass

    def _calculate_agent_usage(self) -> dict:
        """Agent usage statistics"""
        total = sum(len(v) for v in self.cli_invocations.values())
        if total == 0:
            return {}

        usage = {}
        for agent, invokes in self.cli_invocations.items():
            if invokes:
                usage[agent] = {
                    'count': len(invokes),
                    'percentage': round(100 * len(invokes) / total, 1),
                    'last_used': invokes[-1].isoformat() if invokes else None,
                }

        return dict(sorted(usage.items(), key=lambda x: x[1]['count'], reverse=True))

    def _calculate_timeline(self) -> dict:
        """Time-based patterns"""
        if not self.history_entries:
            return {}

        # Group by date
        by_date = defaultdict(int)
        by_hour = defaultdict(int)
        by_day_of_week = defaultdict(int)

        for entry in self.history_entries:
            by_date[entry['date'].isoformat()] += 1
            by_hour[entry['hour']] += 1
            by_day_of_week[entry['day']] += 1

        # Last 7 days trend
        last_7_days = []
        today = datetime.now().date()
        for i in range(6, -1, -1):
            date = today - timedelta(days=i)
            count = by_date.get(date.isoformat(), 0)
            last_7_days.append({
                'date': date.isoformat(),
                'day': date.strftime('%a'),
                'count': count
            })

        # Peak hours
        peak_hour = max(by_hour.items(), key=lambda x: x[1])[0] if by_hour else None

        return {
            'last_7_days': last_7_days,
            'peak_hour': peak_hour,
            'by_hour': dict(by_hour),
            'by_day_of_week': dict(by_day_of_week),
            'date_range': {
                'first': self.history_entries[0]['timestamp'].isoformat(),
                'last': self.history_entries[-1]['timestamp'].isoformat(),
            }
        }

    def _calculate_patterns(self) -> dict:
        """Usage patterns and insights"""
        if not self.history_entries:
            return {}

        # Session duration (rough estimate from gaps)
        durations = []
        sorted_entries = sorted(self.history_entries, key=lambda x: x['timestamp'])

        for i in range(1, len(sorted_entries)):
            gap = (sorted_entries[i]['timestamp'] - sorted_entries[i-1]['timestamp']).total_seconds() / 60
            # Sessions are continuous if <30 min apart
            if gap < 30:
                durations.append(gap)

        avg_session = statistics.mean(durations) if durations else 0

        # Agent switching frequency
        agent_switches = 0
        prev_agent = None
        for entry in sorted_entries:
            for agent in ['claude', 'codex', 'qwen', 'gemini', 'kimi']:
                if agent in entry['command'].lower():
                    if prev_agent and prev_agent != agent:
                        agent_switches += 1
                    prev_agent = agent
                    break

        return {
            'average_session_minutes': round(avg_session, 1),
            'agent_switches': agent_switches,
            'loyalty_score': self._calculate_loyalty(),
        }

    def _calculate_loyalty(self) -> str:
        """How loyal are you to one agent?"""
        usage = self._calculate_agent_usage()
        if not usage:
            return "Unknown"

        top_agent_pct = list(usage.values())[0]['percentage']

        if top_agent_pct >= 80:
            return "Extremely Loyal 💯"
        elif top_agent_pct >= 60:
            return "Very Loyal ✅"
        elif top_agent_pct >= 40:
            return "Balanced ⚖️"
        else:
            return "Experimental 🔬"

    def _calculate_streaks(self) -> dict:
        """Consecutive days of activity"""
        if not self.history_entries:
            return {}

        dates_with_activity = set(entry['date'] for entry in self.history_entries)
        sorted_dates = sorted(dates_with_activity)

        current_streak = 1
        longest_streak = 1
        longest_start = sorted_dates[0]
        current_start = sorted_dates[0]

        for i in range(1, len(sorted_dates)):
            if (sorted_dates[i] - sorted_dates[i-1]).days == 1:
                current_streak += 1
            else:
                if current_streak > longest_streak:
                    longest_streak = current_streak
                    longest_start = current_start
                current_streak = 1
                current_start = sorted_dates[i]

        # Check if current streak is ongoing
        if (datetime.now().date() - sorted_dates[-1]).days <= 1:
            is_active = True
        else:
            is_active = False

        return {
            'current_streak': current_streak if is_active else 0,
            'longest_streak': longest_streak,
            'longest_streak_dates': f"{longest_start} to {longest_start + timedelta(days=longest_streak-1)}"
        }

    def _save_metrics(self, metrics: dict):
        """Save metrics to cache file"""
        METRICS_FILE.parent.mkdir(exist_ok=True, parents=True)
        with open(METRICS_FILE, 'w') as f:
            json.dump(metrics, f, indent=2)


def get_metrics() -> dict:
    """Get current metrics"""
    collector = MetricsCollector()
    return collector.analyze()


if __name__ == "__main__":
    metrics = get_metrics()
    print(json.dumps(metrics, indent=2))
