import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-[#050608]">
      <div className="text-center">
        <h1 className="font-[family-name:var(--font-display)] text-4xl tracking-[0.3em] text-[#ff9900]">
          TARIK OS
        </h1>
        <p className="mt-2 font-[family-name:var(--font-mono-hud)] text-xs tracking-[0.25em] text-[#99ccff]">
          MORPHEUS · IDENTITY VERIFICATION REQUIRED
        </p>
      </div>
      <SignIn />
    </main>
  );
}
