import { useState, useRef, useEffect, useCallback } from "react";

const TOPICS = [
  { id: "travel", emoji: "✈️", label: "Travel", prompt: "Let's practice English for traveling — airports, hotels, asking for directions, and exploring new places." },
  { id: "business", emoji: "💼", label: "Business", prompt: "Let's practice professional English — meetings, emails, presentations, and workplace conversations." },
  { id: "daily", emoji: "☕", label: "Daily Life", prompt: "Let's chat in English about everyday topics — food, hobbies, weekend plans, and casual conversation." },
  { id: "interview", emoji: "🎯", label: "Job Interview", prompt: "Let's practice English for job interviews — talking about your experience, strengths, and career goals." },
  { id: "debate", emoji: "🗣️", label: "Discussion", prompt: "Let's have a thoughtful English discussion — share opinions, agree or disagree, and practice expressing ideas." },
  { id: "storytelling", emoji: "📖", label: "Storytelling", prompt: "Let's practice storytelling in English — share experiences, describe events, and narrate stories." },
];

const SYSTEM_PROMPT = (topicPrompt) => `You are an encouraging and warm English tutor who speaks to Korean learners. ${topicPrompt}

When the user sends a message (which may contain Korean words, grammar errors, or mixed Korean-English), you must respond in this EXACT JSON format:

{
  "hasErrors": true or false,
  "original": "what the user said",
  "corrected": "the corrected full English version (only if hasErrors is true, otherwise null)",
  "correctionNote": "brief, friendly explanation of what was fixed in Korean (only if hasErrors is true, otherwise null)",
  "tutorReply": "your natural conversational English response to continue the discussion (1-2 sentences, warm and encouraging)"
}

Rules:
- If the input is already perfect English with no errors, set hasErrors to false and corrected/correctionNote to null
- Keep corrections positive and encouraging, never harsh
- The tutorReply should be natural conversation that invites the user to keep speaking
- Always respond ONLY with valid JSON, no other text`;

export default function EnglishTutor() {
  const [screen, setScreen] = useState("apikey"); // apikey | topics | tutor
  const [apiKey, setApiKey] = useState("");
  const [selectedTopic, setSelectedTopic] = useState(null);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [lastCorrection, setLastCorrection] = useState(null);
  const [tutorMessage, setTutorMessage] = useState(null);
  const [history, setHistory] = useState([]);
  const [waveAmplitudes, setWaveAmplitudes] = useState([0.2, 0.4, 0.3, 0.6, 0.4, 0.3, 0.2]);
  const [error, setError] = useState(null);

  const recognitionRef = useRef(null);
  const synthRef = useRef(window.speechSynthesis);
  const waveIntervalRef = useRef(null);

  const animateWave = useCallback((active) => {
    if (waveIntervalRef.current) clearInterval(waveIntervalRef.current);
    if (active) {
      waveIntervalRef.current = setInterval(() => {
        setWaveAmplitudes(Array.from({ length: 7 }, () => 0.2 + Math.random() * 0.8));
      }, 120);
    } else {
      setWaveAmplitudes([0.2, 0.3, 0.2, 0.3, 0.2, 0.3, 0.2]);
    }
  }, []);

  useEffect(() => () => {
    if (waveIntervalRef.current) clearInterval(waveIntervalRef.current);
    synthRef.current?.cancel();
  }, []);

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
    utter.onstart = () => { setIsSpeaking(true); animateWave(true); };
    utter.onend = () => { setIsSpeaking(false); animateWave(false); };
    synthRef.current?.speak(utter);
  }, [animateWave]);

  const startListening = useCallback(() => {
    if (!("webkitSpeechRecognition" in window) && !("SpeechRecognition" in window)) {
      setError("이 브라우저는 음성 인식을 지원하지 않아요. Chrome을 사용해주세요.");
      return;
    }
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new SpeechRecognition();
    rec.lang = "en-US";
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onstart = () => { setIsListening(true); animateWave(true); setError(null); };
    rec.onresult = (e) => {
      const text = e.results[0][0].transcript;
      setTranscript(text);
      processWithAI(text);
    };
    rec.onerror = (e) => {
      setIsListening(false);
      animateWave(false);
      if (e.error !== "aborted") setError("음성 인식 오류: " + e.error);
    };
    rec.onend = () => { setIsListening(false); animateWave(false); };
    recognitionRef.current = rec;
    rec.start();
  }, [animateWave, selectedTopic, history]);

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
    setIsListening(false);
    animateWave(false);
  }, [animateWave]);

  const processWithAI = useCallback(async (text) => {
    setIsThinking(true);
    setLastCorrection(null);
    setTutorMessage(null);
    try {
      const messages = [
        ...history,
        { role: "user", content: text }
      ];
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          system: SYSTEM_PROMPT(selectedTopic.prompt),
          messages,
        }),
      });
      const data = await response.json();
      const raw = data.content?.[0]?.text || "{}";
      const clean = raw.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(clean);

      setLastCorrection(parsed.hasErrors ? {
        original: parsed.original,
        corrected: parsed.corrected,
        note: parsed.correctionNote,
      } : null);
      setTutorMessage(parsed.tutorReply);
      setHistory(prev => [
        ...prev,
        { role: "user", content: text },
        { role: "assistant", content: parsed.tutorReply },
      ]);
      speak(parsed.tutorReply);
    } catch (e) {
      setError("AI 연결 오류가 발생했어요. 잠시 후 다시 시도해주세요.");
    } finally {
      setIsThinking(false);
    }
  }, [selectedTopic, history, speak]);

  const startTopic = (topic) => {
    setSelectedTopic(topic);
    setHistory([]);
    setLastCorrection(null);
    setTutorMessage(null);
    setTranscript("");
    setScreen("tutor");
    setTimeout(() => {
      const intro = "Hi! I'm your English tutor. I'm here to help you speak naturally and confidently. Go ahead and say anything — don't worry about mistakes!";
      setTutorMessage(intro);
      speak(intro);
    }, 600);
  };

  if (screen === "apikey") return <ApiKeyScreen onSubmit={(key) => { setApiKey(key); setScreen("topics"); }} />;
  if (screen === "topics") return <TopicScreen onSelect={startTopic} />;
  return (
    <TutorScreen
      topic={selectedTopic}
      isListening={isListening}
      isSpeaking={isSpeaking}
      isThinking={isThinking}
      transcript={transcript}
      lastCorrection={lastCorrection}
      tutorMessage={tutorMessage}
      waveAmplitudes={waveAmplitudes}
      error={error}
      onStart={startListening}
      onStop={stopListening}
      onBack={() => { synthRef.current?.cancel(); setScreen("topics"); }}
    />
  );
}


function ApiKeyScreen({ onSubmit }) {
  const [key, setKey] = useState("");
  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(135deg, #0a0e1a 0%, #0d1528 50%, #0a1020 100%)",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      padding: "40px 20px", fontFamily: "sans-serif",
    }}>
      <div style={{ textAlign: "center", marginBottom: 40 }}>
        <div style={{ fontSize: 13, letterSpacing: "0.3em", color: "#4a9eff", marginBottom: 12, textTransform: "uppercase", fontFamily: "Courier New, monospace" }}>Personal English Tutor</div>
        <h1 style={{ fontSize: 28, fontWeight: 400, color: "#e8edf5", margin: 0, fontFamily: "Georgia, serif" }}>API 키를 입력해주세요</h1>
        <p style={{ color: "#5a7090", marginTop: 10, fontSize: 14 }}>console.anthropic.com에서 발급받은 키를 넣어요</p>
      </div>
      <div style={{ width: "100%", maxWidth: 380 }}>
        <input
          type="password"
          placeholder="sk-ant-..."
          value={key}
          onChange={e => setKey(e.target.value)}
          style={{
            width: "100%", padding: "14px 16px", borderRadius: 12, fontSize: 15,
            background: "rgba(255,255,255,0.05)", border: "1px solid rgba(74,158,255,0.3)",
            color: "#e0eaf8", outline: "none", boxSizing: "border-box", marginBottom: 14,
            fontFamily: "Courier New, monospace",
          }}
        />
        <button
          onClick={() => key.trim() && onSubmit(key.trim())}
          style={{
            width: "100%", padding: "14px", borderRadius: 12, fontSize: 15, fontWeight: 600,
            background: key.trim() ? "rgba(74,158,255,0.2)" : "rgba(74,158,255,0.05)",
            border: "1px solid rgba(74,158,255,0.4)", color: key.trim() ? "#4a9eff" : "#2a5070",
            cursor: key.trim() ? "pointer" : "not-allowed", transition: "all 0.2s",
          }}
        >시작하기 →</button>
        <p style={{ color: "#2a4060", fontSize: 12, textAlign: "center", marginTop: 14 }}>키는 이 앱 안에서만 사용되며 저장되지 않아요</p>
      </div>
    </div>
  );
}

function TopicScreen({ onSelect }) {
  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(135deg, #0a0e1a 0%, #0d1528 50%, #0a1020 100%)",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      padding: "40px 20px",
      fontFamily: "'Georgia', serif",
    }}>
      <div style={{ marginBottom: 48, textAlign: "center" }}>
        <div style={{
          fontSize: 13,
          letterSpacing: "0.3em",
          color: "#4a9eff",
          marginBottom: 12,
          textTransform: "uppercase",
          fontFamily: "'Courier New', monospace",
        }}>Personal English Tutor</div>
        <h1 style={{
          fontSize: "clamp(28px, 5vw, 42px)",
          fontWeight: 400,
          color: "#e8edf5",
          margin: 0,
          letterSpacing: "-0.02em",
          lineHeight: 1.2,
        }}>
          오늘 어떤 주제로<br />
          <span style={{ color: "#4a9eff", fontStyle: "italic" }}>연습할까요?</span>
        </h1>
        <p style={{ color: "#5a7090", marginTop: 12, fontSize: 14, fontFamily: "sans-serif" }}>
          주제를 선택하면 AI 튜터와 바로 대화가 시작돼요
        </p>
      </div>

      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
        gap: 16,
        maxWidth: 560,
        width: "100%",
      }}>
        {TOPICS.map((topic, i) => (
          <button
            key={topic.id}
            onClick={() => onSelect(topic)}
            style={{
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(74,158,255,0.15)",
              borderRadius: 16,
              padding: "24px 16px",
              cursor: "pointer",
              color: "#c8d8ec",
              textAlign: "center",
              transition: "all 0.2s ease",
              animation: `fadeUp 0.4s ease ${i * 0.07}s both`,
              fontFamily: "sans-serif",
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = "rgba(74,158,255,0.1)";
              e.currentTarget.style.borderColor = "rgba(74,158,255,0.4)";
              e.currentTarget.style.transform = "translateY(-2px)";
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = "rgba(255,255,255,0.03)";
              e.currentTarget.style.borderColor = "rgba(74,158,255,0.15)";
              e.currentTarget.style.transform = "translateY(0)";
            }}
          >
            <div style={{ fontSize: 32, marginBottom: 10 }}>{topic.emoji}</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#e0eaf8" }}>{topic.label}</div>
          </button>
        ))}
      </div>

      <style>{`
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(16px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

function TutorScreen({
  topic, isListening, isSpeaking, isThinking,
  transcript, lastCorrection, tutorMessage,
  waveAmplitudes, error, onStart, onStop, onBack
}) {
  const isActive = isListening || isSpeaking || isThinking;

  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(160deg, #070c18 0%, #0c1425 60%, #080e1c 100%)",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      padding: "24px 20px 40px",
      fontFamily: "'Georgia', serif",
      position: "relative",
    }}>
      {/* Header */}
      <div style={{
        width: "100%",
        maxWidth: 520,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 32,
      }}>
        <button onClick={onBack} style={{
          background: "none",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 8,
          color: "#5a7090",
          cursor: "pointer",
          padding: "6px 12px",
          fontSize: 13,
          fontFamily: "sans-serif",
          transition: "all 0.15s",
        }}
          onMouseEnter={e => e.currentTarget.style.color = "#a0b8d0"}
          onMouseLeave={e => e.currentTarget.style.color = "#5a7090"}
        >← 주제 변경</button>
        <div style={{
          fontSize: 12,
          color: "#3a6080",
          letterSpacing: "0.2em",
          textTransform: "uppercase",
          fontFamily: "'Courier New', monospace",
        }}>{topic.emoji} {topic.label}</div>
      </div>

      {/* Orb / Wave Visualizer */}
      <div style={{
        width: 140,
        height: 140,
        borderRadius: "50%",
        background: isListening
          ? "radial-gradient(circle, rgba(74,158,255,0.2) 0%, rgba(74,158,255,0.05) 60%, transparent 100%)"
          : isSpeaking
          ? "radial-gradient(circle, rgba(100,220,160,0.2) 0%, rgba(100,220,160,0.05) 60%, transparent 100%)"
          : "radial-gradient(circle, rgba(30,50,80,0.4) 0%, transparent 70%)",
        border: `2px solid ${isListening ? "rgba(74,158,255,0.5)" : isSpeaking ? "rgba(100,220,160,0.5)" : "rgba(255,255,255,0.06)"}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        marginBottom: 32,
        position: "relative",
        transition: "all 0.4s ease",
        boxShadow: isListening
          ? "0 0 40px rgba(74,158,255,0.15)"
          : isSpeaking
          ? "0 0 40px rgba(100,220,160,0.15)"
          : "none",
      }}>
        {isThinking ? (
          <div style={{ display: "flex", gap: 6 }}>
            {[0, 1, 2].map(i => (
              <div key={i} style={{
                width: 8, height: 8, borderRadius: "50%",
                background: "#4a9eff",
                animation: `bounce 0.8s ease ${i * 0.15}s infinite`,
              }} />
            ))}
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 4, height: 40 }}>
            {waveAmplitudes.map((amp, i) => (
              <div key={i} style={{
                width: 4,
                height: `${amp * 36 + 4}px`,
                borderRadius: 2,
                background: isListening ? "#4a9eff" : isSpeaking ? "#64dcA0" : "#1e3050",
                transition: "height 0.1s ease",
              }} />
            ))}
          </div>
        )}
      </div>

      {/* Status label */}
      <div style={{
        fontSize: 12,
        letterSpacing: "0.2em",
        textTransform: "uppercase",
        fontFamily: "'Courier New', monospace",
        color: isListening ? "#4a9eff" : isSpeaking ? "#64dcA0" : isThinking ? "#f0a030" : "#2a4060",
        marginBottom: 32,
        minHeight: 18,
        transition: "color 0.3s",
      }}>
        {isListening ? "● Listening..." : isSpeaking ? "● Speaking..." : isThinking ? "● Thinking..." : "Ready"}
      </div>

      {/* Cards area */}
      <div style={{ width: "100%", maxWidth: 520, display: "flex", flexDirection: "column", gap: 12, marginBottom: 32 }}>

        {/* User transcript */}
        {transcript && (
          <div style={{
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 12,
            padding: "14px 18px",
            animation: "fadeUp 0.3s ease",
          }}>
            <div style={{ fontSize: 11, color: "#3a5070", fontFamily: "'Courier New', monospace", letterSpacing: "0.15em", marginBottom: 6 }}>YOU SAID</div>
            <div style={{ color: "#8aabcc", fontSize: 15, lineHeight: 1.6, fontFamily: "sans-serif" }}>{transcript}</div>
          </div>
        )}

        {/* Correction card */}
        {lastCorrection && (
          <div style={{
            background: "rgba(255,180,50,0.05)",
            border: "1px solid rgba(255,180,50,0.2)",
            borderRadius: 12,
            padding: "16px 18px",
            animation: "fadeUp 0.3s ease 0.1s both",
          }}>
            <div style={{ fontSize: 11, color: "#c08020", fontFamily: "'Courier New', monospace", letterSpacing: "0.15em", marginBottom: 10 }}>✏️ CORRECTION</div>
            <div style={{ color: "#f0d080", fontSize: 15, lineHeight: 1.6, fontFamily: "sans-serif", marginBottom: 10, fontStyle: "italic" }}>
              "{lastCorrection.corrected}"
            </div>
            {lastCorrection.note && (
              <div style={{ color: "#a08040", fontSize: 13, fontFamily: "sans-serif", lineHeight: 1.5 }}>
                💡 {lastCorrection.note}
              </div>
            )}
          </div>
        )}

        {/* Tutor reply */}
        {tutorMessage && (
          <div style={{
            background: "rgba(100,220,160,0.05)",
            border: "1px solid rgba(100,220,160,0.15)",
            borderRadius: 12,
            padding: "16px 18px",
            animation: "fadeUp 0.3s ease 0.2s both",
          }}>
            <div style={{ fontSize: 11, color: "#30805a", fontFamily: "'Courier New', monospace", letterSpacing: "0.15em", marginBottom: 8 }}>🎓 TUTOR</div>
            <div style={{ color: "#90ddb0", fontSize: 15, lineHeight: 1.7, fontFamily: "sans-serif" }}>{tutorMessage}</div>
          </div>
        )}

        {error && (
          <div style={{
            background: "rgba(255,80,80,0.06)",
            border: "1px solid rgba(255,80,80,0.2)",
            borderRadius: 12,
            padding: "12px 18px",
            color: "#ff9090",
            fontSize: 13,
            fontFamily: "sans-serif",
          }}>{error}</div>
        )}
      </div>

      {/* Mic button */}
      <button
        onMouseDown={onStart}
        onMouseUp={onStop}
        onTouchStart={e => { e.preventDefault(); onStart(); }}
        onTouchEnd={e => { e.preventDefault(); onStop(); }}
        disabled={isThinking || isSpeaking}
        style={{
          width: 72,
          height: 72,
          borderRadius: "50%",
          background: isListening
            ? "rgba(74,158,255,0.2)"
            : isThinking || isSpeaking
            ? "rgba(30,50,70,0.3)"
            : "rgba(74,158,255,0.1)",
          border: `2px solid ${isListening ? "#4a9eff" : isThinking || isSpeaking ? "#1e3050" : "rgba(74,158,255,0.3)"}`,
          cursor: isThinking || isSpeaking ? "not-allowed" : "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 28,
          transition: "all 0.2s ease",
          boxShadow: isListening ? "0 0 24px rgba(74,158,255,0.3)" : "none",
          opacity: isThinking || isSpeaking ? 0.4 : 1,
          userSelect: "none",
        }}
      >
        🎤
      </button>
      <div style={{
        marginTop: 10,
        fontSize: 12,
        color: "#2a4060",
        fontFamily: "sans-serif",
        letterSpacing: "0.05em",
      }}>
        {isListening ? "버튼을 놓으면 전송" : "누르고 말하기"}
      </div>

      <style>{`
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes bounce {
          0%, 100% { transform: translateY(0); opacity: 0.5; }
          50% { transform: translateY(-6px); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
