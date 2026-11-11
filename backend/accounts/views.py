from django.contrib.auth import authenticate, get_user_model
from rest_framework import status
from rest_framework.authtoken.models import Token
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from .serializers import RegisterSerializer, UserSerializer

User = get_user_model()


def auth_payload(user):
    token, _ = Token.objects.get_or_create(user=user)
    return {"token": token.key, "user": UserSerializer(user).data}


class RegisterView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = RegisterSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        return Response(auth_payload(user), status=status.HTTP_201_CREATED)


class LoginView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        identifier = (request.data.get("username") or "").strip()
        password = request.data.get("password") or ""
        lookup = {"email__iexact": identifier} if "@" in identifier else {"username__iexact": identifier}
        match = User.objects.filter(**lookup).first()
        if match:
            identifier = match.username
        user = authenticate(username=identifier, password=password)
        if user is None:
            return Response(
                {"detail": "The username or password is incorrect."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response(auth_payload(user))


class MeView(APIView):
    def get(self, request):
        return Response(UserSerializer(request.user).data)


class LogoutView(APIView):
    def post(self, request):
        Token.objects.filter(user=request.user).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
