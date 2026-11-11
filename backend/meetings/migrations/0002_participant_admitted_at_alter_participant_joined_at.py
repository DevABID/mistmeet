from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("meetings", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="participant",
            name="admitted_at",
            field=models.DateTimeField(blank=True, help_text="When they actually entered the call.", null=True),
        ),
        migrations.AlterField(
            model_name="participant",
            name="joined_at",
            field=models.DateTimeField(auto_now_add=True, help_text="When the connection asked to join."),
        ),
    ]
