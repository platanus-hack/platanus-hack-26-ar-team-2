import { Suspense } from "react";

import SignupForm from "@/components/auth/SignupForm";

export default function SignupPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6 py-12">
      <h1 className="mb-2 text-2xl font-semibold">Crear cuenta</h1>
      <p className="mb-8 text-sm opacity-70">
        ¿Ya tenés cuenta?{" "}
        <a href="/login" className="underline">
          Iniciar sesión
        </a>
        .
      </p>
      <Suspense fallback={<p className="text-sm opacity-60">Cargando…</p>}>
        <SignupForm />
      </Suspense>
    </main>
  );
}
