import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("meetings", "0003_chat_files"),
    ]

    operations = [
        migrations.CreateModel(
            name="Whiteboard",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("state", models.JSONField(default=dict)),
                ("locked", models.BooleanField(default=False, help_text="When on, only the host can draw.")),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "meeting",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="whiteboard",
                        to="meetings.meeting",
                    ),
                ),
            ],
        ),
    ]
