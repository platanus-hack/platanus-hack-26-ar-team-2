import LoginForm from "@/components/auth/LoginForm";

export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6 py-12">
      <h1 className="mb-2 text-2xl font-semibold">Iniciar sesión</h1>
      <p className="mb-8 text-sm opacity-70">
        Login en Addie. ¿Sin cuenta?{" "}
        <a href="/signup" className="underline">
          Crear una
        </a>
        .
      </p>
      <LoginForm />
    </main>
  );
}
