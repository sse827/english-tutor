import { useState, useRef, useEffect, useCallback } from "react";

const LEVELS = [
  { id: "A1", label: "A1", name: "Beginner", desc: "아주 기초 단계", color: "#4ade80" },
  { id: "A2", label: "A2", name: "Elementary", desc: "기초 단계", color: "#86efac" },
  { id: "B1", label: "B1", name: "Intermediate", desc: "중급 단계", color: "#60a5fa" },
  { id: "B2", label: "B2", name: "Upper-Int", desc: "중상급 단계", color: "#a78bfa" },
  { id: "C1", label: "C1", name: "Advanced", desc: "고급 단계", color: "#f472b6" },
];

const TOPICS = [
  { id: "daily", emoji: "☕", label: "일상 대화" },
  { id: "travel", emoji: "✈️", label: "여행" },
  { id: "business", emoji: "💼", label: "비즈니스" },
  { id: "interview", emoji: "🎯", label: "취업 인터뷰" },
  { id: "debate", emoji: "🗣️", label: "토론" },
  { id: "storytelling", emoji: "📖", label: "스토리텔링" },
];

const TOPIC_PROMPTS = {
  daily: "everyday topics like food, hobbies, weekend plans, and casual conversation",
  travel: "traveling — airports, hotels, asking for directions, and exploring new places",
  business: "professional topics — meetings, emails, presentations, and workplace conversations",
  interview: "job interviews — experience, strengths, career goals, and behavioral questions",
  debate: "discussing opinions, agreeing or disagreeing, and expressing ideas clearly",
  storytelling: "sharing experiences, describing events, and narrating stories",
};

const LEVEL_INSTRUCTIONS = {
  A1: "Use very simple words and short sentences. Explain corrections in very simple Korean. Be extremely encouraging.",
  A2: "Use simple vocabulary. Keep corrections brief and friendly. Focus on the most important error only.",
  B1: "Use everyday vocabulary. Point out 1-2 key errors with clear explanation in Korean.",
  B2: "Use natural vocabulary. Point out grammar and vocabulary errors, explain why in Korean.",
  C1: "Use sophisticated vocabulary. Give detailed corrections including nuance, register, and style in Korean.",
};

const buildSystemPrompt = (level, topic) => `You are a warm, encouraging English tutor for Korean learners practicing ${TOPIC_PROMPTS[topic]}.

The student's level is ${level.id} (${level.name}). ${LEVEL_INSTRUCTIONS[level.id]}

When the student sends a message, respond ONLY with this exact JSON:
{
  "reaction": "A warm 1-sentence reaction/acknowledgment in English that shows you understood what they said (e.g. 'Oh nice, sounds like you had a great day!')",
  "hasErrors": true or false,
  "corrected": "The corrected full English sentence (null if no errors)",
  "correctionNote": "Brief friendly Korean explanation of what was fixed and why (null if no errors)",
  "reply": "Your natural conversational English follow-up (1-2 sentences that invite them to keep talking, appropriate for ${level.id} level)"
}

Rules:
- React naturally to what they said before correcting
- For A1/A2: only correct the most critical error, ignore minor ones
- For B1+: correct grammar and vocabulary errors
- Always be warm and never discouraging
- ONLY output valid JSON, nothing else`;

export default function App() {
  const [screen, setScreen] = useState("apikey");
  const [apiKey, setApiKey] = useState("");
  const [level, setLevel] = useState(null);
  const [topic, setTopic] = useState(null);
  const [messages, setMessages] = useState([]);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [error, setError] = useState(null);
  const [history, setHistory] = useState([]);

  const recognitionRef = useRef(null);
  const synthRef = useRef(window.speechSynthesis);
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isThinking]);

  const speak = useCallback((text) => {
    synthRef.current?.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = "en-US";
    utter.rate = 0.92;
    utter.pitch = 1.05;
    const voices = synthRef.current?.getVoices() || [];
    const preferred = voices.find(v => v.lang === "en-US" && v.name.includes("Samantha"))
      || voices.find(v => v.lang === "en-US" && !v.localService)
      || voices.find(v => v.lang.startsWith("en"));
    if (preferred) utter.voice = preferred;
    utter.onstart = () => setIsSpeaking(true);
    utter.onend = () => setIsSpeaking(false);
    synthRef.current?.speak(utter);
  }, []);

  const processWithAI = useCallback(async (text) => {
    setIsThinking(true);
    setError(null);
    try {
      const msgs = [...history, { role: "user", content: text }];
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          system: buildSystemPrompt(level, topic.id),
          messages: msgs,
        }),
      });
      const data = await res.json();
      const raw = data.content?.[0]?.text || "{}";
      const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());

      const tutorText = `${parsed.reaction} ${parsed.reply}`;
      setMessages(prev => [...prev, {
        type: "tutor",
        reaction: parsed.reaction,
        hasErrors: parsed.hasErrors,
        corrected: parsed.corrected,
        correctionNote: parsed.correctionNote,
        reply: parsed.reply,
      }]);
      setHistory(prev => [
        ...prev,
        { role: "user", content: text },
        { role: "assistant", content: tutorText },
      ]);
      speak(tutorText);
    } catch (e) {
      setError("AI 연결 오류. API 키와 크레딧을 확인해주세요.");
    } finally {
      setIsThinking(false);
    }
  }, [apiKey, level, topic, history, speak]);

  const startListening = useCallback(() => {
    if (!("webkitSpeechRecognition" in window) && !("SpeechRecognition" in window)) {
      setError("Chrome 브라우저를 사용해주세요.");
      return;
    }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new SR();
    rec.lang = "en-US";
    rec.interimResults = false;
    rec.onstart = () => { setIsListening(true); setError(null); };
    rec.onresult = (e) => {
      const text = e.results[0][0].transcript;
      setMessages(prev => [...prev, { type: "user", text }]);
      processWithAI(text);
    };
    rec.onerror = (e) => {
      setIsListening(false);
      if (e.error !== "aborted") setError("마이크 오류: " + e.error);
    };
    rec.onend = () => setIsListening(false);
    recognitionRef.current = rec;
    rec.start();
  }, [processWithAI]);

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
    setIsListening(false);
  }, []);

  const startSession = () => {
    setMessages([]);
    setHistory([]);
    setScreen("chat");
    setTimeout(() => {
      const intro = `Hi! I'm your English tutor. We'll be chatting about ${TOPIC_PROMPTS[topic.id]}. I'm here to help you at the ${level.id} level — just speak naturally and don't worry about mistakes!`;
      setMessages([{ type: "tutor", reaction: intro, hasErrors: false, corrected: null, correctionNote: null, reply: "Ready when you are! 🎤" }]);
      speak(intro);
    }, 400);
  };

  if (screen === "apikey") return <ApiKeyScreen onSubmit={k => { setApiKey(k); setScreen("setup"); }} />;
  if (screen === "setup") return <SetupScreen levels={LEVELS} topics={TOPICS} onStart={(l, t) => { setLevel(l); setTopic(t); startSession(); }} />;

  return (
    <div style={{ minHeight: "100vh", background: "#0a0e1a", display: "flex", flexDirection: "column", fontFamily: "sans-serif" }}>
      {/* Header */}
      <div style={{
        padding: "12px 16px", borderBottom: "1px solid rgba(255,255,255,0.07)",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        background: "rgba(255,255,255,0.02)",
      }}>
        <button onClick={() => { synthRef.current?.cancel(); setScreen("setup"); }} style={{
          background: "none", border: "none", color: "#4a7090", cursor: "pointer", fontSize: 13, padding: 0,
        }}>← 설정 변경</button>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{
            background: level?.color + "22", border: `1px solid ${level?.color}55`,
            color: level?.color, borderRadius: 6, padding: "2px 8px", fontSize: 12, fontWeight: 700,
          }}>{level?.id}</span>
          <span style={{ color: "#4a7090", fontSize: 13 }}>{topic?.emoji} {topic?.label}</span>
        </div>
        <div style={{ width: 60 }} />
      </div>

      {/* Chat area */}
      <div style={{ flex: 1, overflowY: "auto", padding: "16px", display: "flex", flexDirection: "column", gap: 12 }}>
        {messages.map((msg, i) => (
          <div key={i}>
            {msg.type === "user" && (
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <div style={{
                  background: "rgba(74,158,255,0.15)", border: "1px solid rgba(74,158,255,0.25)",
                  borderRadius: "16px 16px 4px 16px", padding: "10px 14px",
                  color: "#c8dff5", fontSize: 15, maxWidth: "75%", lineHeight: 1.5,
                }}>{msg.text}</div>
              </div>
            )}
            {msg.type === "tutor" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, maxWidth: "85%" }}>
                {/* Reaction */}
                <div style={{
                  background: "rgba(100,220,160,0.08)", border: "1px solid rgba(100,220,160,0.2)",
                  borderRadius: "16px 16px 16px 4px", padding: "10px 14px",
                  color: "#90ddb0", fontSize: 15, lineHeight: 1.6,
                }}>
                  <span style={{ fontSize: 11, color: "#30805a", display: "block", marginBottom: 4, letterSpacing: "0.1em" }}>🎓 TUTOR</span>
                  {msg.reaction}
                </div>
                {/* Correction */}
                {msg.hasErrors && (
                  <div style={{
                    background: "rgba(255,180,50,0.06)", border: "1px solid rgba(255,180,50,0.2)",
                    borderRadius: 12, padding: "10px 14px",
                  }}>
                    <span style={{ fontSize: 11, color: "#c08020", display: "block", marginBottom: 6, letterSpacing: "0.1em" }}>✏️ 교정</span>
                    <div style={{ color: "#f0d080", fontSize: 14, fontStyle: "italic", marginBottom: 6 }}>"{msg.corrected}"</div>
                    {msg.correctionNote && <div style={{ color: "#a08040", fontSize: 13 }}>💡 {msg.correctionNote}</div>}
                  </div>
                )}
                {/* Reply */}
                {msg.reply && msg.reply !== msg.reaction && (
                  <div style={{
                    background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)",
                    borderRadius: 12, padding: "10px 14px",
                    color: "#8aabcc", fontSize: 15, lineHeight: 1.6,
                  }}>{msg.reply}</div>
                )}
              </div>
            )}
          </div>
        ))}
        {isThinking && (
          <div style={{ display: "flex", gap: 5, padding: "10px 14px" }}>
            {[0,1,2].map(i => (
              <div key={i} style={{
                width: 8, height: 8, borderRadius: "50%", background: "#4a9eff",
                animation: `bounce 0.8s ease ${i * 0.15}s infinite`,
              }} />
            ))}
          </div>
        )}
        {error && (
          <div style={{
            background: "rgba(255,80,80,0.08)", border: "1px solid rgba(255,80,80,0.2)",
            borderRadius: 10, padding: "10px 14px", color: "#ff9090", fontSize: 13,
          }}>{error}</div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Mic bar */}
      <div style={{
        padding: "16px", borderTop: "1px solid rgba(255,255,255,0.07)",
        display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
        background: "rgba(255,255,255,0.02)",
      }}>
        {isSpeaking && (
          <div style={{ fontSize: 12, color: "#64dcA0", letterSpacing: "0.15em" }}>● AI 말하는 중...</div>
        )}
        <button
          onMouseDown={startListening}
          onMouseUp={stopListening}
          onTouchStart={e => { e.preventDefault(); startListening(); }}
          onTouchEnd={e => { e.preventDefault(); stopListening(); }}
          disabled={isThinking || isSpeaking}
          style={{
            width: 64, height: 64, borderRadius: "50%",
            background: isListening ? "rgba(74,158,255,0.2)" : "rgba(74,158,255,0.08)",
            border: `2px solid ${isListening ? "#4a9eff" : "rgba(74,158,255,0.3)"}`,
            cursor: isThinking || isSpeaking ? "not-allowed" : "pointer",
            fontSize: 26, display: "flex", alignItems: "center", justifyContent: "center",
            opacity: isThinking || isSpeaking ? 0.4 : 1,
            boxShadow: isListening ? "0 0 20px rgba(74,158,255,0.3)" : "none",
            transition: "all 0.2s", userSelect: "none",
          }}
        >🎤</button>
        <div style={{ fontSize: 12, color: "#2a4060" }}>
          {isListening ? "버튼을 놓으면 전송" : isThinking ? "AI 생각 중..." : "누르고 말하기"}
        </div>
      </div>

      <style>{`
        @keyframes bounce {
          0%, 100% { transform: translateY(0); opacity: 0.4; }
          50% { transform: translateY(-5px); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

function ApiKeyScreen({ onSubmit }) {
  const [key, setKey] = useState("");
  return (
    <div style={{
      minHeight: "100vh", background: "linear-gradient(135deg, #0a0e1a 0%, #0d1528 100%)",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      padding: "40px 20px", fontFamily: "sans-serif",
    }}>
      <div style={{ textAlign: "center", marginBottom: 40 }}>
        <div style={{ fontSize: 12, letterSpacing: "0.3em", color: "#4a9eff", marginBottom: 12, textTransform: "uppercase" }}>Personal English Tutor</div>
        <h1 style={{ fontSize: 28, fontWeight: 400, color: "#e8edf5", margin: 0, fontFamily: "Georgia, serif" }}>API 키 입력</h1>
        <p style={{ color: "#5a7090", marginTop: 8, fontSize: 14 }}>console.anthropic.com에서 발급</p>
      </div>
      <div style={{ width: "100%", maxWidth: 360 }}>
        <input
          type="password" placeholder="sk-ant-..."
          value={key} onChange={e => setKey(e.target.value)}
          onKeyDown={e => e.key === "Enter" && key.trim() && onSubmit(key.trim())}
          style={{
            width: "100%", padding: "14px 16px", borderRadius: 12, fontSize: 15,
            background: "rgba(255,255,255,0.05)", border: "1px solid rgba(74,158,255,0.3)",
            color: "#e0eaf8", outline: "none", boxSizing: "border-box", marginBottom: 12,
            fontFamily: "monospace",
          }}
        />
        <button onClick={() => key.trim() && onSubmit(key.trim())} style={{
          width: "100%", padding: "14px", borderRadius: 12, fontSize: 15, fontWeight: 600,
          background: key.trim() ? "rgba(74,158,255,0.2)" : "rgba(74,158,255,0.05)",
          border: "1px solid rgba(74,158,255,0.4)",
          color: key.trim() ? "#4a9eff" : "#2a5070",
          cursor: key.trim() ? "pointer" : "not-allowed",
        }}>시작하기 →</button>
        <p style={{ color: "#2a4060", fontSize: 12, textAlign: "center", marginTop: 12 }}>키는 저장되지 않아요</p>
      </div>
    </div>
  );
}

function SetupScreen({ levels, topics, onStart }) {
  const [selLevel, setSelLevel] = useState(null);
  const [selTopic, setSelTopic] = useState(null);
  const canStart = selLevel && selTopic;

  return (
    <div style={{
      minHeight: "100vh", background: "linear-gradient(135deg, #0a0e1a 0%, #0d1528 100%)",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      padding: "32px 20px", fontFamily: "sans-serif", gap: 32,
    }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 12, letterSpacing: "0.3em", color: "#4a9eff", marginBottom: 8, textTransform: "uppercase" }}>Personal English Tutor</div>
        <h1 style={{ fontSize: 26, fontWeight: 400, color: "#e8edf5", margin: 0, fontFamily: "Georgia, serif" }}>레벨과 주제를 선택하세요</h1>
      </div>

      {/* Level */}
      <div style={{ width: "100%", maxWidth: 480 }}>
        <div style={{ fontSize: 12, color: "#4a7090", letterSpacing: "0.15em", marginBottom: 10, textTransform: "uppercase" }}>📊 레벨 (CEFR)</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {levels.map(l => (
            <button key={l.id} onClick={() => setSelLevel(l)} style={{
              flex: 1, minWidth: 80, padding: "12px 8px", borderRadius: 12, cursor: "pointer",
              background: selLevel?.id === l.id ? l.color + "22" : "rgba(255,255,255,0.03)",
              border: `1px solid ${selLevel?.id === l.id ? l.color : "rgba(255,255,255,0.08)"}`,
              color: selLevel?.id === l.id ? l.color : "#6a8aaa",
              textAlign: "center", transition: "all 0.2s",
            }}>
              <div style={{ fontWeight: 700, fontSize: 16 }}>{l.id}</div>
              <div style={{ fontSize: 11, marginTop: 2 }}>{l.desc}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Topic */}
      <div style={{ width: "100%", maxWidth: 480 }}>
        <div style={{ fontSize: 12, color: "#4a7090", letterSpacing: "0.15em", marginBottom: 10, textTransform: "uppercase" }}>💬 주제</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {topics.map(t => (
            <button key={t.id} onClick={() => setSelTopic(t)} style={{
              padding: "12px 16px", borderRadius: 12, cursor: "pointer",
              background: selTopic?.id === t.id ? "rgba(74,158,255,0.12)" : "rgba(255,255,255,0.03)",
              border: `1px solid ${selTopic?.id === t.id ? "rgba(74,158,255,0.4)" : "rgba(255,255,255,0.08)"}`,
              color: selTopic?.id === t.id ? "#4a9eff" : "#6a8aaa",
              textAlign: "left", display: "flex", alignItems: "center", gap: 8, transition: "all 0.2s",
            }}>
              <span style={{ fontSize: 20 }}>{t.emoji}</span>
              <span style={{ fontSize: 14, fontWeight: 500 }}>{t.label}</span>
            </button>
          ))}
        </div>
      </div>

      <button onClick={() => canStart && onStart(selLevel, selTopic)} style={{
        padding: "14px 48px", borderRadius: 12, fontSize: 16, fontWeight: 600, cursor: canStart ? "pointer" : "not-allowed",
        background: canStart ? "rgba(74,158,255,0.2)" : "rgba(74,158,255,0.05)",
        border: `1px solid ${canStart ? "rgba(74,158,255,0.5)" : "rgba(74,158,255,0.1)"}`,
        color: canStart ? "#4a9eff" : "#2a5070", transition: "all 0.2s",
      }}>
        대화 시작 🎤
      </button>
    </div>
  );
}
