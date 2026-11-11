"""
Attendance report for one meeting.

A person can join, drop, and rejoin (or be open in two tabs), so each
person's time is the union of their sessions: overlapping sessions are
merged so nobody is counted twice.

The report uses only Python datetimes and plain values, so the JSON API
and the PDF renderer can share it.
"""

from collections import defaultdict

from django.db.models import Count
from django.utils import timezone

from .models import Participant


def _merge(intervals):
    merged = []
    for start, end in sorted(intervals):
        if merged and start <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], end)
        else:
            merged.append([start, end])
    return merged


def _peak(per_person_intervals):
    """Most people in the call at the same moment."""
    events = []
    for intervals in per_person_intervals:
        for start, end in intervals:
            events.append((start, 1))
            events.append((end, -1))
    events.sort(key=lambda e: (e[0], e[1]))  # leaves before joins at the same instant
    peak = current = 0
    for _, delta in events:
        current += delta
        peak = max(peak, current)
    return peak


def build_report(meeting, now=None):
    now = now or timezone.now()
    sessions = list(meeting.participants.select_related("user").order_by("joined_at"))

    by_user = defaultdict(list)
    requested_but_denied = {}
    for p in sessions:
        if p.admitted_at:
            live = meeting.is_active and p.status == Participant.Status.ADMITTED and p.left_at is None
            end = now if live else (p.left_at or meeting.ended_at or now)
            if meeting.ended_at:
                end = min(end, meeting.ended_at)
            by_user[p.user_id].append({"p": p, "start": p.admitted_at, "end": max(end, p.admitted_at), "live": live})
        elif p.status == Participant.Status.DENIED:
            requested_but_denied[p.user_id] = p

    message_counts = {
        row["user_id"]: row["n"]
        for row in meeting.messages.exclude(user=None).order_by().values("user_id").annotate(n=Count("id"))
    }

    merged_by_user = {uid: _merge([[s["start"], s["end"]] for s in items]) for uid, items in by_user.items()}
    all_starts = [iv[0] for ivs in merged_by_user.values() for iv in ivs]
    all_ends = [iv[1] for ivs in merged_by_user.values() for iv in ivs]
    started_at = min(all_starts) if all_starts else None
    in_call_now = any(s["live"] for items in by_user.values() for s in items)
    ended_at = meeting.ended_at or (None if in_call_now else (max(all_ends) if all_ends else None))
    duration = ((ended_at or now) - started_at).total_seconds() if started_at else 0

    rows = []
    for uid, items in by_user.items():
        merged = merged_by_user[uid]
        total = sum((e - s).total_seconds() for s, e in merged)
        latest = items[-1]["p"]
        live = any(s["live"] for s in items)
        rows.append(
            {
                "name": latest.display_name,
                "username": latest.user.username,
                "email": latest.user.email,
                "is_host": uid == meeting.host_id,
                "first_joined": merged[0][0],
                "last_left": None if live else merged[-1][1],
                "total_seconds": int(total),
                "sessions": len(items),
                "attendance_percent": min(100, round(100 * total / duration)) if duration else 0,
                "in_call": live,
                "messages": message_counts.get(uid, 0),
            }
        )
    rows.sort(key=lambda r: r["first_joined"])

    declined = [
        {"name": p.display_name, "email": p.user.email, "requested_at": p.joined_at}
        for uid, p in requested_but_denied.items()
        if uid not in by_user
    ]

    totals = [r["total_seconds"] for r in rows]
    return {
        "meeting": {
            "code": meeting.code,
            "title": meeting.title,
            "host_name": meeting.host.get_full_name().strip() or meeting.host.username,
            "scheduled_for": meeting.scheduled_for,
            "is_active": meeting.is_active,
            "started_at": started_at,
            "ended_at": ended_at,
            "duration_seconds": int(duration),
        },
        "summary": {
            "attendees": len(rows),
            "peak": _peak(merged_by_user.values()),
            "average_seconds": int(sum(totals) / len(totals)) if totals else 0,
            "declined": len(declined),
            "messages": sum(message_counts.values()),
        },
        "participants": rows,
        "declined": declined,
        "generated_at": now,
    }


def serialize(value):
    """Convert datetimes in the report to ISO strings for JSON."""
    if isinstance(value, dict):
        return {k: serialize(v) for k, v in value.items()}
    if isinstance(value, list):
        return [serialize(v) for v in value]
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return value
