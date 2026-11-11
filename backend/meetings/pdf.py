"""Render an attendance report (see attendance.build_report) as a PDF."""

from html import escape
from io import BytesIO
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

ACCENT = colors.HexColor("#6B4226")
ACCENT_SOFT = colors.HexColor("#F1E4D6")
TEXT = colors.HexColor("#2B1D14")
MUTED = colors.HexColor("#7A6455")
LINE = colors.HexColor("#E6D8C9")
ZEBRA = colors.HexColor("#FAF5EF")
GREEN = colors.HexColor("#4F7A3A")

BASE = ParagraphStyle("base", fontName="Helvetica", fontSize=9, leading=12, textColor=TEXT, alignment=TA_LEFT)
SMALL = ParagraphStyle("small", parent=BASE, fontSize=8, leading=10, textColor=MUTED)
BRAND = ParagraphStyle("brand", parent=BASE, fontName="Helvetica-Bold", fontSize=10, textColor=ACCENT)
TITLE = ParagraphStyle("title", parent=BASE, fontName="Helvetica-Bold", fontSize=20, leading=24)
SUBTITLE = ParagraphStyle("subtitle", parent=BASE, fontSize=11, leading=14, textColor=MUTED)
H2 = ParagraphStyle("h2", parent=BASE, fontName="Helvetica-Bold", fontSize=12, leading=16, spaceBefore=6)
HEAD = ParagraphStyle("head", parent=BASE, fontName="Helvetica-Bold", fontSize=8.5, textColor=colors.white)
STAT_VALUE = ParagraphStyle("statv", parent=BASE, fontName="Helvetica-Bold", fontSize=16, leading=20)
STAT_LABEL = ParagraphStyle("statl", parent=SMALL)


def format_duration(seconds):
    seconds = int(seconds or 0)
    h, rem = divmod(seconds, 3600)
    m, s = divmod(rem, 60)
    if h:
        return f"{h}h {m:02d}m"
    if m:
        return f"{m}m {s:02d}s"
    return f"{s}s"


def _tz(name):
    try:
        return ZoneInfo(name or "UTC")
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo("UTC")


def render_attendance_pdf(report, tz_name="UTC"):
    tz = _tz(tz_name)

    def dt(value, with_date=True):
        if not value:
            return "-"
        local = value.astimezone(tz)
        time = local.strftime("%I:%M %p").lstrip("0")
        return f"{local.strftime('%d %b %Y')}, {time}" if with_date else time

    m, summary, rows = report["meeting"], report["summary"], report["participants"]
    buffer = BytesIO()
    page = landscape(A4)
    doc = SimpleDocTemplate(
        buffer,
        pagesize=page,
        leftMargin=15 * mm,
        rightMargin=15 * mm,
        topMargin=14 * mm,
        bottomMargin=16 * mm,
        title=f"Attendance report - {m['title'] or m['code']}",
        author="MIST Meet",
    )
    width = page[0] - doc.leftMargin - doc.rightMargin
    story = []

    # ---- header
    story += [
        Paragraph("MIST Meet", BRAND),
        Spacer(1, 4),
        Paragraph("Attendance report", TITLE),
        Paragraph(escape(m["title"] or "Untitled meeting"), SUBTITLE),
        Spacer(1, 10),
    ]

    # ---- meeting details (two label/value pairs per row)
    status = "In progress" if m["is_active"] and not m["ended_at"] else "Ended"
    details = [
        ("Meeting code", m["code"]),
        ("Host", m["host_name"]),
        ("Started", dt(m["started_at"])),
        ("Ended", dt(m["ended_at"]) if m["ended_at"] else "In progress"),
        ("Scheduled for", dt(m["scheduled_for"]) if m["scheduled_for"] else "Not scheduled"),
        ("Status", status),
        ("Time zone", str(tz)),
        ("Generated", dt(report["generated_at"])),
    ]
    detail_rows = []
    for i in range(0, len(details), 2):
        row = []
        for label, value in details[i : i + 2]:
            row += [Paragraph(label, SMALL), Paragraph(escape(str(value)), BASE)]
        detail_rows.append(row)
    col = width / 4
    details_table = Table(detail_rows, colWidths=[col * 0.38, col * 1.62, col * 0.38, col * 1.62])
    details_table.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LINEBELOW", (0, 0), (-1, -2), 0.5, LINE),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ]
        )
    )
    story += [details_table, Spacer(1, 12)]

    # ---- summary figures
    stats = [
        (str(summary["attendees"]), "People attended"),
        (str(summary["peak"]), "Most at one time"),
        (format_duration(summary["average_seconds"]), "Average time per person"),
        (format_duration(m["duration_seconds"]), "Meeting length"),
        (str(summary["declined"]), "Requests declined"),
    ]
    stats_table = Table(
        [[Paragraph(v, STAT_VALUE) for v, _ in stats], [Paragraph(l, STAT_LABEL) for _, l in stats]],
        colWidths=[width / len(stats)] * len(stats),
    )
    stats_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), ACCENT_SOFT),
                ("LINEAFTER", (0, 0), (-2, -1), 1, colors.white),
                ("TOPPADDING", (0, 0), (-1, 0), 9),
                ("BOTTOMPADDING", (0, -1), (-1, -1), 9),
                ("LEFTPADDING", (0, 0), (-1, -1), 10),
            ]
        )
    )
    story += [stats_table, Spacer(1, 16), Paragraph(f"Participants ({len(rows)})", H2), Spacer(1, 6)]

    # ---- participants table
    headers = ["#", "Name", "Email", "Role", "First joined", "Last left", "Time in meeting", "Sessions", "Attendance", "Chat msgs"]
    widths = [0.035, 0.16, 0.19, 0.055, 0.14, 0.09, 0.095, 0.075, 0.085, 0.075]
    data = [[Paragraph(h, HEAD) for h in headers]]
    for i, r in enumerate(rows, start=1):
        name = escape(r["name"])
        if r["username"] and r["username"] != r["name"]:
            name += f"<br/><font size=7 color='#7A6455'>@{escape(r['username'])}</font>"
        data.append(
            [
                Paragraph(str(i), BASE),
                Paragraph(name, BASE),
                Paragraph(escape(r["email"] or "-"), BASE),
                Paragraph("Host" if r["is_host"] else "Guest", BASE),
                Paragraph(dt(r["first_joined"]), BASE),
                Paragraph(
                    "<font color='#4F7A3A'>Still in call</font>" if r["in_call"] else dt(r["last_left"], with_date=False),
                    BASE,
                ),
                Paragraph(format_duration(r["total_seconds"]), BASE),
                Paragraph(str(r["sessions"]), BASE),
                Paragraph(f"{r['attendance_percent']}%", BASE),
                Paragraph(str(r["messages"]), BASE),
            ]
        )
    if not rows:
        data.append([Paragraph("No one has joined this meeting yet.", SMALL)] + [""] * (len(headers) - 1))

    table = Table(data, colWidths=[width * w for w in widths], repeatRows=1)
    style = [
        ("BACKGROUND", (0, 0), (-1, 0), ACCENT),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LINEBELOW", (0, 1), (-1, -1), 0.5, LINE),
    ]
    for row_index in range(2, len(data), 2):
        style.append(("BACKGROUND", (0, row_index), (-1, row_index), ZEBRA))
    if not rows:
        style.append(("SPAN", (0, 1), (-1, 1)))
    table.setStyle(TableStyle(style))
    story.append(table)

    # ---- declined requests
    if report["declined"]:
        story += [Spacer(1, 16), Paragraph(f"Requests declined ({len(report['declined'])})", H2), Spacer(1, 6)]
        declined_data = [[Paragraph(h, HEAD) for h in ["Name", "Email", "Asked to join at"]]]
        for d in report["declined"]:
            declined_data.append(
                [Paragraph(escape(d["name"]), BASE), Paragraph(escape(d["email"] or "-"), BASE), Paragraph(dt(d["requested_at"]), BASE)]
            )
        declined_table = Table(declined_data, colWidths=[width * 0.3, width * 0.4, width * 0.3], repeatRows=1)
        declined_table.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), MUTED),
                    ("TOPPADDING", (0, 0), (-1, -1), 6),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                    ("LINEBELOW", (0, 1), (-1, -1), 0.5, LINE),
                ]
            )
        )
        story.append(declined_table)

    story += [
        Spacer(1, 14),
        Paragraph(
            "Time in meeting counts from when a person was admitted to when they left. "
            "If someone rejoined or was connected on two devices at once, overlapping time is counted once. "
            "Attendance is time in meeting divided by meeting length.",
            SMALL,
        ),
    ]

    def footer(canvas, doc_):
        canvas.saveState()
        canvas.setFont("Helvetica", 8)
        canvas.setFillColor(MUTED)
        canvas.drawString(doc_.leftMargin, 9 * mm, f"MIST Meet attendance report  |  {m['code']}  |  Developed by Abidur Rahman")
        canvas.drawRightString(page[0] - doc_.rightMargin, 9 * mm, f"Page {doc_.page}")
        canvas.restoreState()

    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    return buffer.getvalue()
