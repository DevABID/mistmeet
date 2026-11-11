from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("meetings", "0004_whiteboard"),
    ]

    operations = [
        migrations.AddField(
            model_name="participant",
            name="last_seen",
            field=models.DateTimeField(blank=True, help_text="Last heartbeat from this connection.", null=True),
        ),
    ]
