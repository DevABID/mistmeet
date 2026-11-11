import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("meetings", "0002_participant_admitted_at_alter_participant_joined_at"),
    ]

    operations = [
        migrations.AlterField(
            model_name="chatmessage",
            name="text",
            field=models.TextField(blank=True, max_length=2000),
        ),
        migrations.AddField(
            model_name="chatmessage",
            name="file_name",
            field=models.CharField(blank=True, max_length=255),
        ),
        migrations.AddField(
            model_name="chatmessage",
            name="file_type",
            field=models.CharField(blank=True, max_length=100),
        ),
        migrations.AddField(
            model_name="chatmessage",
            name="file_size",
            field=models.PositiveIntegerField(blank=True, null=True),
        ),
        migrations.CreateModel(
            name="ChatFile",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("data", models.BinaryField()),
                (
                    "message",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="file_data",
                        to="meetings.chatmessage",
                    ),
                ),
            ],
        ),
    ]
