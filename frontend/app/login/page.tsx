"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Eye, EyeOff, User, Lock, Sparkles, BookOpen, Presentation, Lightbulb, TrendingUp, Award, Zap } from "lucide-react";
import { loginApi, registerApi } from "@/lib/api";

type TabType = "login" | "register";

const PARTICLES = [
  { id: 1, size: 60, delay: 0, duration: 25, x: "10%", y: "20%" },
  { id: 2, size: 40, delay: 2, duration: 20, x: "80%", y: "15%" },
  { id: 3, size: 80, delay: 4, duration: 30, x: "15%", y: "70%" },
  { id: 4, size: 50, delay: 1, duration: 22, x: "85%", y: "65%" },
  { id: 5, size: 35, delay: 3, duration: 18, x: "50%", y: "85%" },
];

function getSavedUsername(): string {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") return "";
  try { return window.localStorage.getItem("remembered_username") || ""; } catch { return ""; }
}

export default function LoginPage() {
  const [activeTab, setActiveTab] = useState<TabType>("login");
  const [loginForm, setLoginForm] = useState({ username: "", password: "", rememberMe: false });
  const [registerForm, setRegisterForm] = useState({ nickname: "", username: "", password: "" });
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const saved = getSavedUsername();
    if (saved) setLoginForm((f) => ({ ...f, username: saved, rememberMe: true }));
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!loginForm.username || !loginForm.password) { setError("请填写完整的登录信息"); return; }
    setLoading(true);
    try {
      await loginApi(loginForm.username, loginForm.password);
      if (loginForm.rememberMe) window.localStorage.setItem("remembered_username", loginForm.username);
      else window.localStorage.removeItem("remembered_username");
      window.location.href = "/";
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "登录失败，请重试。");
    } finally { setLoading(false); }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!registerForm.nickname || !registerForm.username || !registerForm.password) { setError("请填写完整的注册信息"); return; }
    if (registerForm.password.length < 6) { setError("密码长度至少为6位"); return; }
    setLoading(true);
    try {
      const email = registerForm.username.includes("@") ? registerForm.username : `${registerForm.username}@local`;
      await registerApi(email, registerForm.password, registerForm.nickname);
      window.location.href = "/";
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "注册失败，请重试。");
    } finally { setLoading(false); }
  };

  const particles = PARTICLES;

  return (
    <div className="min-h-screen flex relative overflow-hidden" style={{ backgroundColor: "#f5f1eb" }}>
      {/* Animated gradient background overlay */}
      <div className="absolute inset-0 opacity-30">
        <motion.div
          className="absolute inset-0"
          style={{
            background: "radial-gradient(circle at 20% 30%, #6f8c68 0%, transparent 50%), radial-gradient(circle at 80% 70%, #d6a45b 0%, transparent 50%)",
          }}
          animate={{ opacity: [0.3, 0.5, 0.3] }}
          transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
        />
      </div>

      {/* Left Side - Creative Illustration Area */}
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden" style={{ backgroundColor: "#6f8c68" }}>
        {/* Floating particles */}
        {particles.map((particle) => (
          <motion.div
            key={particle.id}
            className="absolute rounded-full opacity-20 blur-2xl"
            style={{ width: particle.size, height: particle.size, backgroundColor: "#d6a45b", left: particle.x, top: particle.y }}
            animate={{ y: [0, -100, 0], x: [0, 50, 0], scale: [1, 1.5, 1] }}
            transition={{ duration: particle.duration, repeat: Infinity, delay: particle.delay, ease: "easeInOut" }}
          />
        ))}

        {/* Grid pattern overlay */}
        <div
          className="absolute inset-0 opacity-5"
          style={{
            backgroundImage: "linear-gradient(to right, white 1px, transparent 1px), linear-gradient(to bottom, white 1px, transparent 1px)",
            backgroundSize: "40px 40px",
          }}
        />

        {/* Main illustration container */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="relative" style={{ marginTop: -60, marginLeft: -40 }}>
            {/* Glow effect behind slides */}
            <motion.div
              className="absolute rounded-full blur-3xl"
              style={{ width: 400, height: 400, backgroundColor: "#d6a45b", opacity: 0.2, left: 50, top: 50 }}
              animate={{ scale: [1, 1.2, 1], opacity: [0.2, 0.3, 0.2] }}
              transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
            />

            {/* 3D Stacked slides */}
            {[0, 1, 2].map((index) => (
              <motion.div
                key={index}
                className="absolute rounded-3xl shadow-2xl"
                style={{
                  width: 360, height: 240, backgroundColor: "white",
                  left: index * 18, top: index * 18, zIndex: 3 - index,
                  boxShadow: `0 ${20 + index * 10}px ${40 + index * 20}px rgba(0, 0, 0, ${0.15 - index * 0.03})`,
                }}
                animate={{ y: [0, -15, 0], rotateY: [0, 5, 0] }}
                transition={{ duration: 4, repeat: Infinity, delay: index * 0.4, ease: "easeInOut" }}
              >
                <div className="p-8 h-full flex flex-col justify-between relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-24 h-24 opacity-10"
                    style={{ background: "linear-gradient(135deg, #6f8c68 0%, transparent 70%)" }} />
                  <div className="space-y-4 relative z-10">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: "#6f8c68" }}>
                        <Presentation className="w-5 h-5 text-white" />
                      </div>
                      <div className="h-4 rounded-lg" style={{ backgroundColor: "#6f8c68", width: "60%" }} />
                    </div>
                    <div className="space-y-2 ml-1">
                      <div className="h-2.5 rounded-full" style={{ backgroundColor: "#d6a45b", width: "95%", opacity: 0.4 }} />
                      <div className="h-2.5 rounded-full" style={{ backgroundColor: "#d6a45b", width: "70%", opacity: 0.4 }} />
                      <div className="h-2.5 rounded-full" style={{ backgroundColor: "#d6a45b", width: "85%", opacity: 0.4 }} />
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex gap-2">
                      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: "#6f8c68" }} />
                      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: "#d6a45b", opacity: 0.3 }} />
                      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: "#d6a45b", opacity: 0.3 }} />
                    </div>
                    <div className="text-xs" style={{ color: "#6f8c68", opacity: 0.6 }}>Slide {index + 1}</div>
                  </div>
                </div>
              </motion.div>
            ))}

            {/* Floating feature icons with glassmorphism */}
            <motion.div
              className="absolute backdrop-blur-lg rounded-2xl p-4 shadow-xl"
              style={{ top: -100, left: 320, backgroundColor: "rgba(255,255,255,0.15)", border: "1px solid rgba(255,255,255,0.3)" }}
              animate={{ y: [0, -25, 0], rotate: [0, 5, 0] }}
              transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
            >
              <BookOpen className="w-7 h-7 text-white" />
            </motion.div>

            <motion.div
              className="absolute backdrop-blur-lg rounded-2xl p-4 shadow-xl"
              style={{ bottom: 180, right: 320, backgroundColor: "rgba(214,164,91,0.25)", border: "1px solid rgba(255,255,255,0.3)" }}
              animate={{ y: [0, 25, 0], rotate: [0, -5, 0] }}
              transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
            >
              <Lightbulb className="w-7 h-7 text-white" />
            </motion.div>

            <motion.div
              className="absolute backdrop-blur-lg rounded-2xl p-4 shadow-xl"
              style={{ top: 240, left: -80, backgroundColor: "rgba(255,255,255,0.15)", border: "1px solid rgba(255,255,255,0.3)" }}
              animate={{ y: [0, -20, 0], rotate: [0, 8, 0] }}
              transition={{ duration: 4.5, repeat: Infinity, ease: "easeInOut" }}
            >
              <TrendingUp className="w-7 h-7 text-white" />
            </motion.div>

            <motion.div
              className="absolute backdrop-blur-lg rounded-2xl p-4 shadow-xl"
              style={{ bottom: -20, left: 380, backgroundColor: "rgba(214,164,91,0.25)", border: "1px solid rgba(255,255,255,0.3)" }}
              animate={{ y: [0, 20, 0], rotate: [0, -8, 0] }}
              transition={{ duration: 5.5, repeat: Infinity, ease: "easeInOut" }}
            >
              <Award className="w-7 h-7 text-white" />
            </motion.div>
          </div>
        </div>

        {/* Enhanced title overlay with glassmorphism */}
        <div className="absolute bottom-16 left-16 z-10">
          <motion.div
            className="backdrop-blur-md rounded-3xl p-6 shadow-2xl"
            style={{ backgroundColor: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.2)" }}
            initial={{ opacity: 0, y: 30, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 1, delay: 0.3 }}
          >
            <div className="flex items-center gap-3 mb-3">
              <motion.div animate={{ rotate: [0, 10, -10, 0] }} transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}>
                <Presentation className="w-10 h-10 text-white" />
              </motion.div>
              <h1 className="text-4xl font-bold text-white">幻灯片研习台</h1>
            </div>
            <p className="text-white/90 text-lg ml-1">Smart Learning Studio</p>
            <div className="flex items-center gap-2 mt-3 ml-1">
              <Sparkles className="w-4 h-4 text-white/70" />
              <p className="text-white/70 text-sm">让每一次演示都成为精彩的学习体验</p>
            </div>
          </motion.div>
        </div>
      </div>

      {/* Right Side - Form Area */}
      <div className="flex-1 flex items-center justify-center p-8 relative">
        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          className="w-full max-w-md relative z-10"
        >
          {/* Mobile Logo */}
          <div className="lg:hidden text-center mb-8">
            <div className="flex items-center justify-center gap-2 mb-2">
              <Presentation className="w-6 h-6" style={{ color: "#6f8c68" }} />
              <h2 className="text-2xl" style={{ color: "#6f8c68" }}>幻灯片研习台</h2>
            </div>
            <p style={{ color: "#d6a45b" }}>Smart Learning Studio</p>
          </div>

          {/* Main form card with glassmorphism */}
          <motion.div
            className="backdrop-blur-xl rounded-3xl p-8 shadow-2xl relative overflow-hidden"
            style={{ backgroundColor: "rgba(255,255,255,0.7)", border: "1px solid rgba(255,255,255,0.8)" }}
            whileHover={{ boxShadow: "0 25px 50px rgba(111,140,104,0.15)" }}
            transition={{ duration: 0.3 }}
          >
            <div className="absolute top-0 right-0 w-32 h-32 rounded-full opacity-5" style={{ backgroundColor: "#6f8c68", transform: "translate(50%, -50%)" }} />
            <div className="absolute bottom-0 left-0 w-24 h-24 rounded-full opacity-5" style={{ backgroundColor: "#d6a45b", transform: "translate(-50%, 50%)" }} />

            {/* Tab Switcher */}
            <div className="relative mb-8">
              <div className="flex rounded-2xl p-1.5 shadow-inner" style={{ backgroundColor: "#e8e3dc" }}>
                <button
                  onClick={() => { setActiveTab("login"); setError(""); }}
                  className="flex-1 py-3.5 rounded-xl transition-all duration-300 relative z-10 flex items-center justify-center gap-2"
                  style={{ color: activeTab === "login" ? "white" : "#6f8c68" }}
                  type="button"
                >
                  <User className="w-4 h-4" /> 登录
                </button>
                <button
                  onClick={() => { setActiveTab("register"); setError(""); }}
                  className="flex-1 py-3.5 rounded-xl transition-all duration-300 relative z-10 flex items-center justify-center gap-2"
                  style={{ color: activeTab === "register" ? "white" : "#6f8c68" }}
                  type="button"
                >
                  <Sparkles className="w-4 h-4" /> 注册
                </button>
                <motion.div
                  className="absolute top-1.5 bottom-1.5 rounded-xl shadow-lg"
                  style={{ background: "linear-gradient(135deg, #6f8c68 0%, #5a7354 100%)", width: "calc(50% - 6px)" }}
                  animate={{ left: activeTab === "login" ? "6px" : "calc(50%)" }}
                  transition={{ type: "spring", stiffness: 300, damping: 30 }}
                />
              </div>
            </div>

            {/* Error Message */}
            <AnimatePresence mode="wait">
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -10, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -10, scale: 0.95 }}
                  className="mb-6 p-4 rounded-xl backdrop-blur-sm flex items-start gap-3 text-[13px]"
                  style={{ backgroundColor: "rgba(254,243,242,0.9)", color: "#991b1b", border: "1px solid #fecaca" }}
                >
                  <Zap className="w-5 h-5 flex-shrink-0 mt-0.5" />
                  <span>{error}</span>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Forms */}
            <AnimatePresence mode="wait">
              {activeTab === "login" ? (
                <motion.form
                  key="login"
                  initial={{ opacity: 0, x: -30 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 30 }}
                  transition={{ duration: 0.4 }}
                  onSubmit={handleLogin}
                  className="space-y-5"
                >
                  <div className="relative group">
                    <div className="absolute left-4 top-1/2 -translate-y-1/2 transition-all duration-300 group-hover:scale-110" style={{ color: "#6f8c68" }}>
                      <User className="w-5 h-5" />
                    </div>
                    <input
                      type="text" value={loginForm.username}
                      onChange={(e) => setLoginForm({ ...loginForm, username: e.target.value })}
                      placeholder="用户名" required autoComplete="username"
                      className="login-v2-input pl-12 pr-4"
                    />
                  </div>

                  <div className="relative group">
                    <div className="absolute left-4 top-1/2 -translate-y-1/2 transition-all duration-300 group-hover:scale-110" style={{ color: "#6f8c68" }}>
                      <Lock className="w-5 h-5" />
                    </div>
                    <input
                      type={showPassword ? "text" : "password"} value={loginForm.password}
                      onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })}
                      placeholder="密码" required minLength={6} autoComplete="current-password"
                      className="login-v2-input pl-12 pr-12"
                    />
                    <motion.button
                      type="button" onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-4 top-1/2 -translate-y-1/2" style={{ color: "#d6a45b" }}
                      whileHover={{ scale: 1.15 }} whileTap={{ scale: 0.95 }} tabIndex={-1}
                    >
                      {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                    </motion.button>
                  </div>

                  <div className="flex items-center gap-2">
                    <input type="checkbox" id="rememberMe" checked={loginForm.rememberMe}
                      onChange={(e) => setLoginForm({ ...loginForm, rememberMe: e.target.checked })}
                      className="w-4 h-4 rounded cursor-pointer" style={{ accentColor: "#6f8c68" }} />
                    <label htmlFor="rememberMe" className="cursor-pointer select-none text-sm" style={{ color: "#4a5946" }}>
                      记住用户名
                    </label>
                  </div>

                  <motion.button
                    type="submit" disabled={loading}
                    whileHover={{ scale: 1.02, boxShadow: "0 10px 30px rgba(111,140,104,0.3)" }}
                    whileTap={{ scale: 0.98 }}
                    className="w-full py-4 rounded-xl text-white transition-all duration-300 shadow-lg relative overflow-hidden disabled:opacity-50"
                    style={{ background: "linear-gradient(135deg, #6f8c68 0%, #5a7354 100%)" }}
                  >
                    <span className="relative z-10 flex items-center justify-center gap-2">
                      {loading ? (
                        <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                        </svg>
                      ) : <Zap className="w-5 h-5" />}
                      {loading ? "处理中..." : "登录"}
                    </span>
                  </motion.button>
                </motion.form>
              ) : (
                <motion.form
                  key="register"
                  initial={{ opacity: 0, x: 30 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -30 }}
                  transition={{ duration: 0.4 }}
                  onSubmit={handleRegister}
                  className="space-y-5"
                >
                  <div className="relative group">
                    <div className="absolute left-4 top-1/2 -translate-y-1/2 transition-all duration-300 group-hover:scale-110" style={{ color: "#6f8c68" }}>
                      <Sparkles className="w-5 h-5" />
                    </div>
                    <input
                      type="text" value={registerForm.nickname}
                      onChange={(e) => setRegisterForm({ ...registerForm, nickname: e.target.value })}
                      placeholder="昵称"
                      className="login-v2-input pl-12 pr-4"
                    />
                  </div>

                  <div className="relative group">
                    <div className="absolute left-4 top-1/2 -translate-y-1/2 transition-all duration-300 group-hover:scale-110" style={{ color: "#6f8c68" }}>
                      <User className="w-5 h-5" />
                    </div>
                    <input
                      type="text" value={registerForm.username}
                      onChange={(e) => setRegisterForm({ ...registerForm, username: e.target.value })}
                      placeholder="用户名" required autoComplete="username"
                      className="login-v2-input pl-12 pr-4"
                    />
                  </div>

                  <div className="relative group">
                    <div className="absolute left-4 top-1/2 -translate-y-1/2 transition-all duration-300 group-hover:scale-110" style={{ color: "#6f8c68" }}>
                      <Lock className="w-5 h-5" />
                    </div>
                    <input
                      type={showPassword ? "text" : "password"} value={registerForm.password}
                      onChange={(e) => setRegisterForm({ ...registerForm, password: e.target.value })}
                      placeholder="密码（至少6位）" required minLength={6} autoComplete="new-password"
                      className="login-v2-input pl-12 pr-12"
                    />
                    <motion.button
                      type="button" onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-4 top-1/2 -translate-y-1/2" style={{ color: "#d6a45b" }}
                      whileHover={{ scale: 1.15 }} whileTap={{ scale: 0.95 }} tabIndex={-1}
                    >
                      {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                    </motion.button>
                  </div>

                  <motion.button
                    type="submit" disabled={loading}
                    whileHover={{ scale: 1.02, boxShadow: "0 10px 30px rgba(111,140,104,0.3)" }}
                    whileTap={{ scale: 0.98 }}
                    className="w-full py-4 rounded-xl text-white transition-all duration-300 shadow-lg relative overflow-hidden disabled:opacity-50"
                    style={{ background: "linear-gradient(135deg, #6f8c68 0%, #5a7354 100%)" }}
                  >
                    <span className="relative z-10 flex items-center justify-center gap-2">
                      {loading ? (
                        <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                        </svg>
                      ) : <Sparkles className="w-5 h-5" />}
                      {loading ? "处理中..." : "注册"}
                    </span>
                  </motion.button>
                </motion.form>
              )}
            </AnimatePresence>

            <motion.p
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.6 }}
              className="mt-8 text-center text-[11px]" style={{ color: "#b8a990" }}
            >
              &copy; 2026 Teaching-Learning
            </motion.p>
          </motion.div>

          {/* Decorative floating elements */}
          <motion.div
            className="absolute top-8 right-8 w-16 h-16 rounded-full opacity-10 blur-xl"
            style={{ backgroundColor: "#6f8c68" }}
            animate={{ scale: [1, 1.5, 1], opacity: [0.1, 0.2, 0.1] }}
            transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
          />
          <motion.div
            className="absolute bottom-16 left-8 w-20 h-20 rounded-full opacity-10 blur-xl"
            style={{ backgroundColor: "#d6a45b" }}
            animate={{ scale: [1, 1.3, 1], opacity: [0.1, 0.2, 0.1] }}
            transition={{ duration: 5, repeat: Infinity, ease: "easeInOut", delay: 1 }}
          />
        </motion.div>
      </div>

      {/* Shared input styles */}
      <style>{`
        .login-v2-input {
          width: 100%;
          padding-top: 1rem;
          padding-bottom: 1rem;
          border-radius: 0.75rem;
          border: 2px solid transparent;
          background-color: rgba(255,255,255,0.9);
          transition: all 0.3s;
          outline: none;
          box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }
        .login-v2-input:focus {
          border-color: #6f8c68;
          background-color: white;
          box-shadow: 0 4px 20px rgba(111,140,104,0.15);
        }
      `}</style>
    </div>
  );
}
