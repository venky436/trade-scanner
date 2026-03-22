"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { TrendingUp, Eye, EyeOff, ArrowRight, Loader2, Check, X } from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4002";

export default function SignupPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Password validation
  const hasMinLength = password.length >= 8;
  const hasUpperCase = /[A-Z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const passwordsMatch = password === confirmPassword && confirmPassword.length > 0;
  const isValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!email || !password || !confirmPassword) {
      setError("Please fill in all required fields");
      return;
    }

    if (!isValidEmail) {
      setError("Please enter a valid email address");
      return;
    }

    if (!hasMinLength) {
      setError("Password must be at least 8 characters");
      return;
    }

    if (!passwordsMatch) {
      setError("Passwords do not match");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch(`${API_URL}/api/user/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, name: name || undefined }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Registration failed");
        return;
      }

      // Auto-login after registration
      const loginRes = await fetch(`${API_URL}/api/user/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });

      const loginData = await loginRes.json();
      if (loginRes.ok && loginData.accessToken) {
        sessionStorage.setItem("accessToken", loginData.accessToken);
        router.push("/");
      } else {
        router.push("/login");
      }
    } catch {
      setError("Connection failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  function PasswordRule({ met, label }: { met: boolean; label: string }) {
    return (
      <div className="flex items-center gap-1.5 text-[11px]">
        {met ? (
          <Check className="size-3 text-green-500" />
        ) : (
          <X className="size-3 text-muted-foreground/30" />
        )}
        <span className={met ? "text-green-500" : "text-muted-foreground/50"}>{label}</span>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      {/* Background gradient */}
      <div className="fixed inset-0 bg-gradient-to-br from-green-500/[0.03] via-transparent to-purple-500/[0.03]" />

      <div className="relative w-full max-w-md">
        {/* Logo */}
        <div className="flex items-center justify-center gap-2 mb-8">
          <div className="flex items-center justify-center size-10 rounded-xl bg-green-500/15">
            <TrendingUp className="size-5 text-green-500" />
          </div>
          <span className="text-2xl font-bold tracking-tight text-foreground">TradeScanner</span>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-border/20 backdrop-blur-xl bg-white/[0.02] p-8 shadow-2xl shadow-black/10">
          <div className="text-center mb-6">
            <h1 className="text-2xl font-bold text-foreground">Create your account</h1>
            <p className="text-sm text-muted-foreground mt-1">Start making smarter trading decisions</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Name (optional) */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Name <span className="text-muted-foreground/40">(optional)</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                className="w-full h-11 px-4 text-sm bg-muted/30 border border-border/30 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500/30 focus:border-green-500/50 placeholder:text-muted-foreground/40 transition-all"
                autoFocus
              />
            </div>

            {/* Email */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className={`w-full h-11 px-4 text-sm bg-muted/30 border rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500/30 focus:border-green-500/50 placeholder:text-muted-foreground/40 transition-all ${
                  email && !isValidEmail ? "border-red-500/50" : "border-border/30"
                }`}
                autoComplete="email"
              />
              {email && !isValidEmail && (
                <p className="text-[11px] text-red-500">Please enter a valid email</p>
              )}
            </div>

            {/* Password */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Password</label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Create a strong password"
                  className="w-full h-11 px-4 pr-10 text-sm bg-muted/30 border border-border/30 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500/30 focus:border-green-500/50 placeholder:text-muted-foreground/40 transition-all"
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/40 hover:text-muted-foreground transition-colors"
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
              {/* Password rules */}
              {password && (
                <div className="flex gap-3 mt-1">
                  <PasswordRule met={hasMinLength} label="8+ chars" />
                  <PasswordRule met={hasUpperCase} label="Uppercase" />
                  <PasswordRule met={hasNumber} label="Number" />
                </div>
              )}
            </div>

            {/* Confirm Password */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Confirm Password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm your password"
                className={`w-full h-11 px-4 text-sm bg-muted/30 border rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500/30 focus:border-green-500/50 placeholder:text-muted-foreground/40 transition-all ${
                  confirmPassword && !passwordsMatch ? "border-red-500/50" : "border-border/30"
                }`}
                autoComplete="new-password"
              />
              {confirmPassword && !passwordsMatch && (
                <p className="text-[11px] text-red-500">Passwords don&apos;t match</p>
              )}
            </div>

            {/* Error */}
            {error && (
              <div className="text-sm text-red-500 bg-red-500/10 rounded-lg px-3 py-2">
                {error}
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading || !hasMinLength || !isValidEmail || !passwordsMatch}
              className="w-full h-11 bg-green-600 hover:bg-green-500 text-white font-semibold rounded-xl transition-all duration-200 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <>
                  Create Account
                  <ArrowRight className="size-4" />
                </>
              )}
            </button>
          </form>

          {/* Login link */}
          <div className="mt-6 text-center">
            <p className="text-sm text-muted-foreground">
              Already have an account?{" "}
              <Link href="/login" className="text-green-500 hover:text-green-400 font-medium transition-colors">
                Sign in
              </Link>
            </p>
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-[10px] text-muted-foreground/40 mt-6">
          Real-time market intelligence for intraday traders
        </p>
      </div>
    </div>
  );
}
