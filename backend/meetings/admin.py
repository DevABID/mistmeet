from django.contrib import admin

from .models import ChatMessage, Meeting, Participant


@admin.register(Meeting)
class MeetingAdmin(admin.ModelAdmin):
    list_display = ("code", "title", "host", "scheduled_for", "is_active", "created_at")
    list_filter = ("is_active", "require_approval")
    search_fields = ("code", "title", "host__username")


@admin.register(Participant)
class ParticipantAdmin(admin.ModelAdmin):
    list_display = ("display_name", "meeting", "status", "admitted_at", "left_at")
    list_filter = ("status",)


@admin.register(ChatMessage)
class ChatMessageAdmin(admin.ModelAdmin):
    list_display = ("display_name", "meeting", "created_at")
