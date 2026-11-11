import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models

import meetings.models


class Migration(migrations.Migration):
    initial = True

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="Meeting",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("code", models.CharField(default=meetings.models.generate_meeting_code, editable=False, max_length=12, unique=True)),
                ("title", models.CharField(blank=True, max_length=200)),
                ("scheduled_for", models.DateTimeField(blank=True, null=True)),
                ("require_approval", models.BooleanField(default=True, help_text="Guests must be admitted by the host before entering.")),
                ("is_active", models.BooleanField(default=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("ended_at", models.DateTimeField(blank=True, null=True)),
                (
                    "host",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="hosted_meetings",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
        ),
        migrations.CreateModel(
            name="ChatMessage",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("peer_id", models.CharField(blank=True, max_length=32)),
                ("display_name", models.CharField(max_length=80)),
                ("text", models.TextField(max_length=2000)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "meeting",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE, related_name="messages", to="meetings.meeting"
                    ),
                ),
                (
                    "user",
                    models.ForeignKey(
                        null=True, on_delete=django.db.models.deletion.SET_NULL, to=settings.AUTH_USER_MODEL
                    ),
                ),
            ],
            options={"ordering": ["created_at"]},
        ),
        migrations.CreateModel(
            name="Participant",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("peer_id", models.CharField(max_length=32, unique=True)),
                ("display_name", models.CharField(max_length=80)),
                (
                    "status",
                    models.CharField(
                        choices=[("waiting", "Waiting"), ("admitted", "Admitted"), ("denied", "Denied"), ("left", "Left")],
                        default="waiting",
                        max_length=10,
                    ),
                ),
                ("audio_on", models.BooleanField(default=True)),
                ("video_on", models.BooleanField(default=True)),
                ("hand_raised", models.BooleanField(default=False)),
                ("is_sharing", models.BooleanField(default=False)),
                ("joined_at", models.DateTimeField(auto_now_add=True)),
                ("left_at", models.DateTimeField(blank=True, null=True)),
                (
                    "meeting",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE, related_name="participants", to="meetings.meeting"
                    ),
                ),
                (
                    "user",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="participations",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "indexes": [models.Index(fields=["meeting", "status"], name="meetings_pa_meeting_7c0f20_idx")],
            },
        ),
    ]
