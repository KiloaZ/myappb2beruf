/**
 * ChallengeRoom.jsx — B2 Beruf Practice App
 *
 * Props:
 *   roomId       — Firebase room ID
 *   currentUser  — { uid, displayName }
 *   questions    — imported from questions.json (array)
 *   onExit       — callback when game ends or user leaves
 *
 * Firebase paths used:
 *   /rooms/{roomId}          — room state (status, round, timer, players)
 *   /rooms/{roomId}/timer    — { startedAt, durationSec, state }
 *
 * Usage:
 *   import questions from './questions.json'
 *   <ChallengeRoom roomId="abc" currentUser={user} questions={questions} onExit={() => navigate('/')} />
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { getDatabase, ref, onValue, set, off, serverTimestamp } from "firebase/database";

const db = getDatabase();
const ROUND_DURATION = 180; // seconds

/* ── pick a random question not already used ── */
function pickRandom(questions, usedIds) {
  const pool = questions.filter(q => !usedIds.includes(q.id));
  if (pool.length === 0) return questions[Math.floor(Math.random() * questions.length)];
  return pool[Math.floor(Math.random() * pool.length)];
}

export default function ChallengeRoom({ roomId, currentUser, questions = [], onExit }) {
  const me = currentUser || { uid: "demo", displayName: "You" };

  /* ── local state ── */
  const [room, setRoom] = useState(null);
  const [timeLeft, setTimeLeft] = useState(ROUND_DURATION);
  const [phase, setPhase] = useState("intro"); // intro | playing | switching | finished
  const [currentQ, setCurrentQ] = useState(null);
  const [usedIds, setUsedIds] = useState([]);
  const [showAnswer, setShowAnswer] = useState(false);
  const [showRedemittel, setShowRedemittel] = useState(false);
  const [myRole, setMyRole] = useState("speaker"); // speaker | listener
  const [round, setRound] = useState(1);
  const [partnerName, setPartnerName] = useState("Partner");

  // ── Finish-screen state ──
  const [sessionHistory, setSessionHistory] = useState([]); // [{q, role}]
  const [reviewIdx, setReviewIdx] = useState(0);
  const [feedbacks, setFeedbacks] = useState({}); // { [qId]: string }
  const [feedbackSaved, setFeedbackSaved] = useState({}); // { [qId]: bool }

  const timerRef = useRef(null);
  const startedAtRef = useRef(null);

  /* ── listen to Firebase room ── */
  useEffect(() => {
    if (!roomId) return;
    const roomRef = ref(db, `rooms/${roomId}`);
    onValue(roomRef, snap => {
      const data = snap.val();
      if (!data) return;
      setRoom(data);

      // derive my role
      if (data.players?.A?.uid === me.uid) setMyRole(data.players.A.role);
      else if (data.players?.B?.uid === me.uid) setMyRole(data.players.B.role);

      // partner name
      const partner = data.players?.A?.uid === me.uid ? data.players?.B : data.players?.A;
      if (partner) setPartnerName(partner.displayName);

      setRound(data.round || 1);

      // sync question
      if (data.currentQuestionId && questions.length) {
        const q = questions.find(q => q.id === data.currentQuestionId);
        if (q) setCurrentQ(q);
      }

      // sync phase
      if (data.status === "active" && phase === "intro") setPhase("playing");
      if (data.status === "switching") setPhase("switching");
      if (data.status === "finished") setPhase("finished");

      // sync timer
      if (data.timer?.startedAt && data.timer?.state === "running") {
        startedAtRef.current = data.timer.startedAt;
      }
    });

    return () => off(roomRef);
  }, [roomId]);

  /* ── countdown ── */
  useEffect(() => {
    clearInterval(timerRef.current);
    if (phase !== "playing" || !startedAtRef.current) return;

    timerRef.current = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAtRef.current) / 1000);
      const left = Math.max(0, ROUND_DURATION - elapsed);
      setTimeLeft(left);
      if (left === 0) handleTimerEnd();
    }, 500);

    return () => clearInterval(timerRef.current);
  }, [phase, startedAtRef.current]);

  /* ── host starts round ── */
  async function startRound(questionOverride) {
    const q = questionOverride || pickRandom(questions, usedIds);
    setCurrentQ(q);
    setUsedIds(prev => [...prev, q.id]);
    setSessionHistory(prev => [...prev, { q, role: myRole }]);
    setShowAnswer(false);
    setShowRedemittel(false);
    startedAtRef.current = Date.now();
    setTimeLeft(ROUND_DURATION);
    setPhase("playing");

    if (roomId) {
      await set(ref(db, `rooms/${roomId}`), {
        ...room,
        status: "active",
        currentQuestionId: q.id,
        timer: { startedAt: Date.now(), durationSec: ROUND_DURATION, state: "running" },
      });
    }
  }

  /* ── timer ends → switch roles ── */
  async function handleTimerEnd() {
    clearInterval(timerRef.current);
    if (round >= 2) {
      setPhase("finished");
      if (roomId) await set(ref(db, `rooms/${roomId}/status`), "finished");
      return;
    }
    setPhase("switching");
    if (roomId) await set(ref(db, `rooms/${roomId}/status`), "switching");
  }

  /* ── switch roles and start round 2 ── */
  async function startRound2() {
    setMyRole(r => r === "speaker" ? "listener" : "speaker");
    setRound(2);
    setShowAnswer(false);
    setShowRedemittel(false);
    if (roomId) {
      await set(ref(db, `rooms/${roomId}/players/A/role`), room?.players?.A?.uid === me.uid ? "listener" : "speaker");
      await set(ref(db, `rooms/${roomId}/players/B/role`), room?.players?.B?.uid === me.uid ? "listener" : "speaker");
      await set(ref(db, `rooms/${roomId}/round`), 2);
    }
    startRound();
  }

  /* ── demo mode (no Firebase) ── */
  useEffect(() => {
    if (!roomId && questions.length > 0) {
      const q = pickRandom(questions, []);
      setCurrentQ(q);
      setUsedIds([q.id]);
    }
  }, []);

  function demoStart() {
    const q = pickRandom(questions, usedIds);
    setCurrentQ(q);
    setUsedIds(prev => [...prev, q.id]);
    setShowAnswer(false);
    setShowRedemittel(false);
    setTimeLeft(ROUND_DURATION);
    startedAtRef.current = Date.now();
    setPhase("playing");
  }

  function demoSwitch() {
    if (round >= 2) { setPhase("finished"); return; }
    setPhase("switching");
  }

  function demoRound2() {
    setRound(2);
    setMyRole(r => r === "speaker" ? "listener" : "speaker");
    const q = pickRandom(questions, usedIds);
    setCurrentQ(q);
    setUsedIds(prev => [...prev, q.id]);
    setShowAnswer(false);
    setShowRedemittel(false);
    setTimeLeft(ROUND_DURATION);
    startedAtRef.current = Date.now();
    setPhase("playing");
  }

  /* ── timer colour ── */
  const timerPct = (timeLeft / ROUND_DURATION) * 100;
  const timerColor = timeLeft > 60 ? "#3ecf6e" : timeLeft > 30 ? "#f5a623" : "#e05252";
  const mins = String(Math.floor(timeLeft / 60)).padStart(2, "0");
  const secs = String(timeLeft % 60).padStart(2, "0");

  const isSpeaker = myRole === "speaker";

  return (
    <>
      <style>{CSS}</style>
      <div className="cr-root">
        <div className="cr-grain" />

        {/* ── header ── */}
        <header className="cr-header">
          <div className="cr-logo">
            <span className="cr-logo-de">DE</span>
            <span className="cr-logo-b2">B2</span>
          </div>
          <div className="cr-header-center">
            <span className="cr-round-badge">Runde {round} / 2</span>
            <span className="cr-role-pill" data-role={myRole}>
              {isSpeaker ? "🎤 Du sprichst" : "👂 Du hörst zu"}
            </span>
            <span className="cr-partner">mit {partnerName}</span>
          </div>
          <button className="cr-exit-btn" onClick={onExit}>✕ Verlassen</button>
        </header>

        {/* ══════════ INTRO ══════════ */}
        {phase === "intro" && (
          <div className="cr-center-stage">
            <div className="cr-intro-card">
              <div className="cr-intro-icon">⚡</div>
              <h1 className="cr-intro-title">Bereit für die Herausforderung?</h1>
              <p className="cr-intro-sub">
                Jede Runde dauert <strong>3 Minuten</strong>. Danach werden die Rollen getauscht.
              </p>
              <div className="cr-intro-roles">
                <div className="cr-intro-role speaker">
                  <span>🎤</span>
                  <span>{isSpeaker ? me.displayName : partnerName}</span>
                  <span className="cr-intro-role-label">spricht zuerst</span>
                </div>
                <div className="cr-intro-arrow">→</div>
                <div className="cr-intro-role listener">
                  <span>👂</span>
                  <span>{isSpeaker ? partnerName : me.displayName}</span>
                  <span className="cr-intro-role-label">hört zu & antwortet</span>
                </div>
              </div>
              <button className="cr-start-btn" onClick={roomId ? () => startRound() : demoStart}>
                Spiel starten
              </button>
            </div>
          </div>
        )}

        {/* ══════════ PLAYING ══════════ */}
        {phase === "playing" && currentQ && (
          <div className="cr-game-layout">

            {/* left: timer */}
            <div className="cr-timer-col">
              <div className="cr-timer-ring">
                <svg viewBox="0 0 100 100">
                  <circle cx="50" cy="50" r="44" fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="6" />
                  <circle
                    cx="50" cy="50" r="44" fill="none"
                    stroke={timerColor}
                    strokeWidth="6"
                    strokeLinecap="round"
                    strokeDasharray={`${2 * Math.PI * 44}`}
                    strokeDashoffset={`${2 * Math.PI * 44 * (1 - timerPct / 100)}`}
                    transform="rotate(-90 50 50)"
                    style={{ transition: "stroke-dashoffset 0.5s linear, stroke 0.5s" }}
                  />
                </svg>
                <div className="cr-timer-text">
                  <span className="cr-timer-digits" style={{ color: timerColor }}>{mins}:{secs}</span>
                  <span className="cr-timer-label">verbleibend</span>
                </div>
              </div>

              <div className="cr-topic-tag">
                <span className="cr-topic-dot" />
                {currentQ.topic}
              </div>

              <div className="cr-round-info">
                <div className="cr-round-pip active" />
                <div className={`cr-round-pip ${round >= 2 ? "active" : ""}`} />
              </div>

              {/* demo skip */}
              {!roomId && (
                <button className="cr-skip-btn" onClick={demoSwitch}>
                  ⏭ Zeit ablaufen lassen
                </button>
              )}
            </div>

            {/* right: question card */}
            <div className="cr-card-col">

              {/* question */}
              <div className="cr-question-card">
                <div className="cr-qcard-header">
                  <span className="cr-qcard-num">Frage</span>
                  <span className="cr-qcard-role" data-role={myRole}>
                    {isSpeaker ? "Deine Frage" : "Kollege/in fragt dich"}
                  </span>
                </div>
                <p className="cr-question-text">{currentQ.question}</p>
              </div>

              {/* redemittel accordion */}
              <div className={`cr-redemittel-box ${showRedemittel ? "open" : ""}`}>
                <button
                  className="cr-redemittel-toggle"
                  onClick={() => setShowRedemittel(v => !v)}
                >
                  <span className="cr-rdm-icon">💬</span>
                  <span>Redemittel anzeigen</span>
                  <span className="cr-rdm-chevron">{showRedemittel ? "▲" : "▼"}</span>
                </button>
                {showRedemittel && (
                  <ul className="cr-redemittel-list">
                    {currentQ.redemittel.map((r, i) => (
                      <li key={i} className="cr-rdm-item">
                        <span className="cr-rdm-bullet" />
                        {r}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* suggested answer */}
              <div className="cr-answer-box">
                <button
                  className={`cr-answer-toggle ${showAnswer ? "open" : ""}`}
                  onClick={() => setShowAnswer(v => !v)}
                >
                  <span className="cr-ans-icon">✨</span>
                  <span>Musterantwort {showAnswer ? "verbergen" : "zeigen"}</span>
                  <span className="cr-ans-chevron">{showAnswer ? "▲" : "▼"}</span>
                </button>
                {showAnswer && (
                  <p className="cr-answer-text">{currentQ.suggestedAnswer}</p>
                )}
              </div>

            </div>
          </div>
        )}

        {/* ══════════ SWITCHING ══════════ */}
        {phase === "switching" && (
          <div className="cr-center-stage">
            <div className="cr-switch-card">
              <div className="cr-switch-anim">🔄</div>
              <h2 className="cr-switch-title">Rollentausch!</h2>
              <p className="cr-switch-sub">
                Runde 1 ist vorbei. Jetzt ist <strong>{isSpeaker ? partnerName : me.displayName}</strong> dran zu sprechen.
              </p>
              <div className="cr-switch-roles">
                <div className="cr-switch-role new-speaker">
                  <span>🎤</span>
                  <span>{isSpeaker ? partnerName : me.displayName}</span>
                </div>
                <div className="cr-switch-arrow">⇄</div>
                <div className="cr-switch-role new-listener">
                  <span>👂</span>
                  <span>{isSpeaker ? me.displayName : partnerName}</span>
                </div>
              </div>
              <button className="cr-start-btn" onClick={roomId ? startRound2 : demoRound2}>
                Runde 2 starten
              </button>
            </div>
          </div>
        )}

        {/* ══════════ FINISHED ══════════ */}
        {phase === "finished" && (() => {
          const history = sessionHistory.length > 0
            ? sessionHistory
            : usedIds.map(id => ({ q: questions.find(q => q.id === id), role: "speaker" })).filter(x => x.q);
          const entry = history[reviewIdx];
          const q = entry?.q;
          const qId = q?.id;
          return (
            <div className="cr-center-stage cr-finish-scroll">
              {/* ── Header stats ── */}
              <div className="cr-finish-header">
                <div className="cr-finish-icon">🏆</div>
                <h1 className="cr-finish-title">Übung abgeschlossen!</h1>
                <p className="cr-finish-sub">Vergleiche deine Antworten mit den Musterlösungen und hinterlasse Feedback für deinen Partner.</p>
                <div className="cr-finish-stats">
                  <div className="cr-fstat">
                    <span className="cr-fstat-num">2</span>
                    <span className="cr-fstat-label">Runden</span>
                  </div>
                  <div className="cr-fstat">
                    <span className="cr-fstat-num">{usedIds.length}</span>
                    <span className="cr-fstat-label">Fragen</span>
                  </div>
                  <div className="cr-fstat">
                    <span className="cr-fstat-num">6</span>
                    <span className="cr-fstat-label">Minuten</span>
                  </div>
                </div>
              </div>

              {/* ── Question navigator ── */}
              {history.length > 0 && (
                <div className="cr-review-wrap">
                  {/* Nav pills */}
                  <div className="cr-review-nav">
                    {history.map((e, i) => (
                      <button
                        key={e.q.id}
                        className={`cr-nav-pill${i === reviewIdx ? " active" : ""}`}
                        onClick={() => { setReviewIdx(i); setFeedbackSaved(s => ({...s, [e.q.id]: false})); }}
                      >
                        {i + 1}
                      </button>
                    ))}
                  </div>

                  {/* Review card */}
                  {q && (
                    <div className="cr-review-card">
                      {/* Topic badge */}
                      <div className="cr-review-topic-row">
                        <span className="cr-topic-badge">{q.topic}</span>
                        <span className="cr-review-role-tag">
                          {entry.role === "speaker" ? "🎙 Du hast gesprochen" : "👂 Du hast zugehört"}
                        </span>
                      </div>

                      {/* Question */}
                      <div className="cr-review-question">
                        <div className="cr-review-q-label">Frage</div>
                        <p className="cr-review-q-text">„{q.question}"</p>
                      </div>

                      {/* Model answer */}
                      <div className="cr-model-answer-block">
                        <div className="cr-model-answer-label">
                          <span>💡</span>
                          <span>Musterlösung</span>
                        </div>
                        <p className="cr-model-answer-text">{q.suggestedAnswer}</p>
                      </div>

                      {/* Redemittel */}
                      {q.redemittel?.length > 0 && (
                        <div className="cr-review-redemittel">
                          <div className="cr-review-redemittel-label">Redemittel</div>
                          <ul className="cr-review-redemittel-list">
                            {q.redemittel.map((r, i) => (
                              <li key={i} className="cr-review-redemittel-item">
                                <span className="cr-r-bullet">›</span>{r}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* Feedback box */}
                      <div className="cr-feedback-block">
                        <label className="cr-feedback-label" htmlFor={`fb-${qId}`}>
                          ✏️ Feedback für {partnerName}
                        </label>
                        <textarea
                          id={`fb-${qId}`}
                          className="cr-feedback-textarea"
                          placeholder={`Schreibe hier eine Notiz oder Feedback für ${partnerName} zu dieser Frage …`}
                          value={feedbacks[qId] || ""}
                          onChange={e => setFeedbacks(f => ({ ...f, [qId]: e.target.value }))}
                          rows={3}
                        />
                        <button
                          className={`cr-feedback-save-btn${feedbackSaved[qId] ? " saved" : ""}`}
                          onClick={() => setFeedbackSaved(s => ({ ...s, [qId]: true }))}
                          disabled={!feedbacks[qId]?.trim()}
                        >
                          {feedbackSaved[qId] ? "✓ Gespeichert" : "Feedback speichern"}
                        </button>
                      </div>

                      {/* Prev / Next */}
                      <div className="cr-review-pagination">
                        <button
                          className="cr-page-btn"
                          onClick={() => setReviewIdx(i => Math.max(0, i - 1))}
                          disabled={reviewIdx === 0}
                        >← Zurück</button>
                        <span className="cr-page-counter">{reviewIdx + 1} / {history.length}</span>
                        <button
                          className="cr-page-btn"
                          onClick={() => setReviewIdx(i => Math.min(history.length - 1, i + 1))}
                          disabled={reviewIdx === history.length - 1}
                        >Weiter →</button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ── Actions ── */}
              <div className="cr-finish-actions cr-finish-actions-bottom">
                <button className="cr-start-btn" onClick={() => {
                  setPhase("intro"); setRound(1); setUsedIds([]); setMyRole("speaker");
                  setSessionHistory([]); setReviewIdx(0); setFeedbacks({}); setFeedbackSaved({});
                }}>
                  Nochmal spielen
                </button>
                <button className="cr-exit-btn2" onClick={onExit}>Zur Lobby</button>
              </div>
            </div>
          );
        })()}
      </div>
    </>
  );
}

/* ─── CSS ─────────────────────────────────────────────────── */
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800&family=DM+Sans:ital,wght@0,300;0,400;0,500;1,300&display=swap');

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --bg:       #0c0d12;
  --surface:  #13151d;
  --surface2: #1c1f2b;
  --border:   rgba(255,255,255,0.07);
  --border2:  rgba(255,255,255,0.12);
  --accent:   #5b7fff;
  --accent2:  #7b9fff;
  --green:    #3ecf6e;
  --amber:    #f5a623;
  --red:      #e05252;
  --text:     #eaecf2;
  --muted:    #7c8096;
  --muted2:   #4a4f62;
  --radius:   16px;
  --fh:       'Syne', sans-serif;
  --fb:       'DM Sans', sans-serif;
}

.cr-root {
  min-height: 100vh;
  background: var(--bg);
  color: var(--text);
  font-family: var(--fb);
  position: relative;
  display: flex;
  flex-direction: column;
}

.cr-grain {
  pointer-events: none;
  position: fixed;
  inset: 0;
  z-index: 0;
  opacity: .03;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
  background-size: 150px;
}

/* ── header ── */
.cr-header {
  position: relative; z-index: 10;
  display: flex; align-items: center; gap: 16px;
  padding: 16px 28px;
  border-bottom: 1px solid var(--border);
  background: rgba(12,13,18,0.9);
  backdrop-filter: blur(12px);
}

.cr-logo { display: flex; align-items: baseline; gap: 3px; font-family: var(--fh); font-weight: 800; }
.cr-logo-de { font-size: 20px; color: var(--accent); }
.cr-logo-b2  { font-size: 13px; color: var(--muted); letter-spacing: .06em; }

.cr-header-center {
  display: flex; align-items: center; gap: 10px; flex: 1; justify-content: center;
  flex-wrap: wrap;
}

.cr-round-badge {
  font-family: var(--fh); font-size: 13px; font-weight: 600;
  background: var(--surface2); border: 1px solid var(--border2);
  border-radius: 99px; padding: 4px 12px;
  color: var(--muted);
}

.cr-role-pill {
  font-family: var(--fh); font-size: 13px; font-weight: 600;
  border-radius: 99px; padding: 4px 14px;
  border: 1px solid;
}
.cr-role-pill[data-role="speaker"] {
  background: rgba(91,127,255,.12); border-color: rgba(91,127,255,.4); color: var(--accent2);
}
.cr-role-pill[data-role="listener"] {
  background: rgba(245,166,35,.1); border-color: rgba(245,166,35,.3); color: var(--amber);
}

.cr-partner { font-size: 13px; color: var(--muted); }

.cr-exit-btn {
  margin-left: auto;
  background: transparent; border: 1px solid var(--border2);
  color: var(--muted); padding: 6px 14px; border-radius: 8px;
  font-family: var(--fh); font-size: 12px; cursor: pointer;
  transition: border-color .2s, color .2s;
}
.cr-exit-btn:hover { border-color: var(--red); color: var(--red); }

/* ── center stage (intro/switch/finish) ── */
.cr-center-stage {
  flex: 1; display: flex; align-items: center; justify-content: center;
  padding: 32px 20px;
  position: relative; z-index: 1;
}

/* ── intro card ── */
.cr-intro-card {
  background: var(--surface); border: 1px solid var(--border2);
  border-radius: 24px; padding: 40px 36px; max-width: 500px; width: 100%;
  display: flex; flex-direction: column; align-items: center; gap: 20px;
  animation: fadeUp .4s ease;
}
@keyframes fadeUp { from{opacity:0;transform:translateY(20px)} to{opacity:1;transform:translateY(0)} }

.cr-intro-icon { font-size: 42px; animation: pulse 2s ease-in-out infinite; }
@keyframes pulse { 0%,100%{transform:scale(1)} 50%{transform:scale(1.12)} }

.cr-intro-title { font-family: var(--fh); font-size: 24px; font-weight: 800; text-align: center; }
.cr-intro-sub { font-size: 15px; color: var(--muted); text-align: center; line-height: 1.6; }

.cr-intro-roles {
  display: flex; align-items: center; gap: 16px; width: 100%;
  background: var(--surface2); border-radius: 14px; padding: 16px;
}
.cr-intro-role {
  flex: 1; display: flex; flex-direction: column; align-items: center; gap: 4px;
  font-size: 13px; font-weight: 500; text-align: center;
}
.cr-intro-role span:first-child { font-size: 22px; }
.cr-intro-role-label { font-size: 11px; color: var(--muted); }
.cr-intro-role.speaker { color: var(--accent2); }
.cr-intro-role.listener { color: var(--amber); }
.cr-intro-arrow { font-size: 20px; color: var(--muted2); }

.cr-start-btn {
  background: var(--accent); color: #fff;
  border: none; border-radius: 12px; padding: 14px 36px;
  font-family: var(--fh); font-size: 15px; font-weight: 700;
  cursor: pointer; transition: opacity .2s, transform .1s; letter-spacing: .02em;
}
.cr-start-btn:hover { opacity: .88; }
.cr-start-btn:active { transform: scale(.97); }

/* ── game layout ── */
.cr-game-layout {
  flex: 1; display: grid; grid-template-columns: 220px 1fr;
  gap: 24px; padding: 28px 32px;
  position: relative; z-index: 1;
  max-width: 1000px; margin: 0 auto; width: 100%;
}

/* ── timer column ── */
.cr-timer-col {
  display: flex; flex-direction: column; align-items: center; gap: 20px;
}

.cr-timer-ring {
  position: relative; width: 160px; height: 160px;
}
.cr-timer-ring svg { width: 100%; height: 100%; }
.cr-timer-text {
  position: absolute; inset: 0;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
}
.cr-timer-digits {
  font-family: var(--fh); font-size: 32px; font-weight: 800; line-height: 1;
  transition: color .5s;
}
.cr-timer-label { font-size: 11px; color: var(--muted); letter-spacing: .05em; }

.cr-topic-tag {
  display: flex; align-items: center; gap: 7px;
  background: var(--surface); border: 1px solid var(--border2);
  border-radius: 99px; padding: 6px 14px;
  font-size: 12px; font-weight: 500; color: var(--muted);
  text-align: center;
}
.cr-topic-dot {
  width: 7px; height: 7px; border-radius: 50%;
  background: var(--accent); box-shadow: 0 0 6px var(--accent);
  flex-shrink: 0;
}

.cr-round-info { display: flex; gap: 8px; }
.cr-round-pip {
  width: 28px; height: 5px; border-radius: 3px;
  background: var(--surface2);
  transition: background .4s;
}
.cr-round-pip.active { background: var(--accent); }

.cr-skip-btn {
  background: transparent; border: 1px dashed var(--muted2);
  color: var(--muted); padding: 8px 16px; border-radius: 8px;
  font-size: 12px; cursor: pointer; font-family: var(--fh);
  transition: border-color .2s, color .2s;
}
.cr-skip-btn:hover { border-color: var(--muted); color: var(--text); }

/* ── card column ── */
.cr-card-col {
  display: flex; flex-direction: column; gap: 16px;
}

/* question card */
.cr-question-card {
  background: var(--surface); border: 1px solid var(--border2);
  border-radius: var(--radius); padding: 28px 28px 24px;
  animation: fadeUp .3s ease;
}
.cr-qcard-header {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 16px;
}
.cr-qcard-num {
  font-family: var(--fh); font-size: 11px; font-weight: 600;
  color: var(--muted); letter-spacing: .1em; text-transform: uppercase;
}
.cr-qcard-role {
  font-size: 12px; font-weight: 500; border-radius: 99px; padding: 3px 12px; border: 1px solid;
}
.cr-qcard-role[data-role="speaker"] {
  background: rgba(91,127,255,.1); border-color: rgba(91,127,255,.35); color: var(--accent2);
}
.cr-qcard-role[data-role="listener"] {
  background: rgba(245,166,35,.1); border-color: rgba(245,166,35,.3); color: var(--amber);
}
.cr-question-text {
  font-size: 20px; font-weight: 500; line-height: 1.55; color: var(--text);
  font-style: italic;
}

/* redemittel */
.cr-redemittel-box {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 14px; overflow: hidden;
  transition: border-color .2s;
}
.cr-redemittel-box.open { border-color: rgba(91,127,255,.4); }

.cr-redemittel-toggle {
  width: 100%; display: flex; align-items: center; gap: 10px;
  background: transparent; border: none; padding: 14px 18px;
  color: var(--accent2); font-family: var(--fh); font-size: 13px; font-weight: 600;
  cursor: pointer; text-align: left;
}
.cr-rdm-icon { font-size: 16px; }
.cr-rdm-chevron { margin-left: auto; font-size: 10px; }

.cr-redemittel-list {
  list-style: none; padding: 4px 18px 16px; display: flex; flex-direction: column; gap: 10px;
  animation: fadeUp .2s ease;
}
.cr-rdm-item {
  display: flex; align-items: baseline; gap: 10px;
  font-size: 14px; color: var(--text); line-height: 1.5;
}
.cr-rdm-bullet {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--accent); flex-shrink: 0; margin-top: 6px;
}

/* answer */
.cr-answer-box {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 14px; overflow: hidden;
  transition: border-color .2s;
}
.cr-answer-toggle {
  width: 100%; display: flex; align-items: center; gap: 10px;
  background: transparent; border: none; padding: 14px 18px;
  color: var(--muted); font-family: var(--fh); font-size: 13px; font-weight: 600;
  cursor: pointer; text-align: left; transition: color .2s;
}
.cr-answer-toggle.open { color: var(--green); }
.cr-ans-icon { font-size: 16px; }
.cr-ans-chevron { margin-left: auto; font-size: 10px; }
.cr-answer-text {
  padding: 4px 18px 18px;
  font-size: 14px; color: var(--muted); line-height: 1.7;
  animation: fadeUp .2s ease;
  border-top: 1px solid var(--border);
  margin: 0 18px;
  padding: 14px 0 18px;
}

/* ── switch card ── */
.cr-switch-card {
  background: var(--surface); border: 1px solid var(--border2);
  border-radius: 24px; padding: 40px 36px; max-width: 480px; width: 100%;
  display: flex; flex-direction: column; align-items: center; gap: 20px;
  animation: fadeUp .4s ease;
}
.cr-switch-anim { font-size: 48px; animation: spin .8s ease-in-out; }
@keyframes spin { from{transform:rotate(0)} to{transform:rotate(360deg)} }
.cr-switch-title { font-family: var(--fh); font-size: 26px; font-weight: 800; }
.cr-switch-sub { font-size: 15px; color: var(--muted); text-align: center; line-height: 1.6; }
.cr-switch-roles {
  display: flex; align-items: center; gap: 20px;
  background: var(--surface2); border-radius: 14px; padding: 16px 24px; width: 100%;
}
.cr-switch-role {
  flex: 1; display: flex; flex-direction: column; align-items: center; gap: 6px;
  font-size: 13px; font-weight: 600;
}
.cr-switch-role span:first-child { font-size: 28px; }
.cr-switch-role.new-speaker { color: var(--accent2); }
.cr-switch-role.new-listener { color: var(--amber); }
.cr-switch-arrow { font-size: 22px; color: var(--muted2); }

/* ── finish card ── */
.cr-finish-card {
  background: var(--surface); border: 1px solid var(--border2);
  border-radius: 24px; padding: 44px 40px; max-width: 520px; width: 100%;
  display: flex; flex-direction: column; align-items: center; gap: 20px;
  animation: fadeUp .4s ease;
}
.cr-finish-icon { font-size: 52px; animation: bounce .6s ease; }
@keyframes bounce { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-14px)} }
.cr-finish-title { font-family: var(--fh); font-size: 28px; font-weight: 800; text-align: center; }
.cr-finish-sub { font-size: 15px; color: var(--muted); text-align: center; line-height: 1.6; }
.cr-finish-stats {
  display: flex; gap: 0; width: 100%;
  background: var(--surface2); border-radius: 14px; overflow: hidden;
}
.cr-fstat {
  flex: 1; display: flex; flex-direction: column; align-items: center;
  padding: 20px 0; gap: 4px;
  border-right: 1px solid var(--border);
}
.cr-fstat:last-child { border-right: none; }
.cr-fstat-num { font-family: var(--fh); font-size: 32px; font-weight: 800; color: var(--accent2); }
.cr-fstat-label { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: .05em; }

.cr-finish-actions { display: flex; gap: 12px; width: 100%; }
.cr-finish-actions .cr-start-btn { flex: 2; }
.cr-exit-btn2 {
  flex: 1; background: var(--surface2); border: 1px solid var(--border2);
  color: var(--muted); border-radius: 12px; padding: 14px 20px;
  font-family: var(--fh); font-size: 14px; font-weight: 600; cursor: pointer;
  transition: color .2s, border-color .2s;
}
.cr-finish-actions-bottom { margin-top: 8px; }
.cr-exit-btn2:hover { color: var(--text); border-color: var(--accent); }

/* ── Finish scroll wrapper ── */
.cr-finish-scroll {
  align-items: center; padding: 32px 20px 40px;
  overflow-y: auto; width: 100%;
}
.cr-finish-header {
  display: flex; flex-direction: column; align-items: center;
  gap: 12px; max-width: 520px; width: 100%; margin-bottom: 8px;
}

/* ── Review block ── */
.cr-review-wrap {
  max-width: 560px; width: 100%; display: flex; flex-direction: column; gap: 16px;
}
.cr-review-nav {
  display: flex; gap: 8px; justify-content: center; flex-wrap: wrap;
}
.cr-nav-pill {
  width: 36px; height: 36px; border-radius: 50%;
  background: var(--surface2); border: 1px solid var(--border2);
  color: var(--muted); font-family: var(--fh); font-size: 13px; font-weight: 700;
  cursor: pointer; transition: background .2s, color .2s, border-color .2s;
}
.cr-nav-pill:hover { background: var(--accent); color: #fff; border-color: var(--accent); }
.cr-nav-pill.active { background: var(--accent); color: #fff; border-color: var(--accent); }

.cr-review-card {
  background: var(--surface); border: 1px solid var(--border2);
  border-radius: 20px; padding: 28px 28px; display: flex;
  flex-direction: column; gap: 20px;
  animation: fadeUp .3s ease;
}
.cr-review-topic-row {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
}
.cr-review-role-tag {
  font-size: 12px; color: var(--muted); background: var(--surface2);
  border: 1px solid var(--border); border-radius: 20px; padding: 3px 10px;
  margin-left: auto;
}

/* Question box */
.cr-review-question { display: flex; flex-direction: column; gap: 6px; }
.cr-review-q-label {
  font-size: 11px; text-transform: uppercase; letter-spacing: .08em;
  color: var(--muted); font-weight: 600;
}
.cr-review-q-text {
  font-size: 15px; line-height: 1.6; color: var(--text);
  background: var(--surface2); border-radius: 10px; padding: 12px 14px;
  border-left: 3px solid var(--accent);
}

/* Model answer */
.cr-model-answer-block {
  background: rgba(61,207,110,.07); border: 1px solid rgba(61,207,110,.2);
  border-radius: 14px; padding: 16px 18px; display: flex; flex-direction: column; gap: 8px;
}
.cr-model-answer-label {
  display: flex; align-items: center; gap: 6px;
  font-size: 12px; font-weight: 700; color: var(--green);
  text-transform: uppercase; letter-spacing: .06em;
}
.cr-model-answer-text {
  font-size: 14px; line-height: 1.7; color: var(--text);
}

/* Redemittel inside review */
.cr-review-redemittel {
  background: var(--surface2); border-radius: 12px; padding: 14px 16px;
  display: flex; flex-direction: column; gap: 8px;
}
.cr-review-redemittel-label {
  font-size: 11px; text-transform: uppercase; letter-spacing: .06em;
  color: var(--accent); font-weight: 700;
}
.cr-review-redemittel-list { list-style: none; display: flex; flex-direction: column; gap: 6px; }
.cr-review-redemittel-item {
  display: flex; align-items: baseline; gap: 8px;
  font-size: 13px; color: var(--muted); line-height: 1.5;
}
.cr-r-bullet { color: var(--accent2); font-size: 16px; flex-shrink: 0; }

/* Feedback */
.cr-feedback-block {
  display: flex; flex-direction: column; gap: 8px;
}
.cr-feedback-label {
  font-size: 13px; font-weight: 600; color: var(--text);
}
.cr-feedback-textarea {
  width: 100%; resize: vertical;
  background: var(--surface2); border: 1px solid var(--border2);
  border-radius: 10px; padding: 12px 14px;
  color: var(--text); font-family: var(--fb); font-size: 14px; line-height: 1.6;
  outline: none; transition: border-color .2s;
  min-height: 80px;
}
.cr-feedback-textarea:focus { border-color: var(--accent); }
.cr-feedback-textarea::placeholder { color: var(--muted2); }
.cr-feedback-save-btn {
  align-self: flex-end;
  background: var(--accent); color: #fff; border: none;
  border-radius: 10px; padding: 10px 22px;
  font-family: var(--fh); font-size: 13px; font-weight: 700;
  cursor: pointer; transition: background .2s, opacity .2s;
}
.cr-feedback-save-btn:disabled { opacity: .35; cursor: default; }
.cr-feedback-save-btn.saved {
  background: var(--green); cursor: default;
}
.cr-feedback-save-btn:not(:disabled):not(.saved):hover { background: var(--accent2); }

/* Pagination */
.cr-review-pagination {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
}
.cr-page-btn {
  background: var(--surface2); border: 1px solid var(--border2);
  color: var(--muted); border-radius: 10px; padding: 9px 18px;
  font-family: var(--fh); font-size: 13px; font-weight: 600;
  cursor: pointer; transition: color .2s, border-color .2s;
}
.cr-page-btn:hover:not(:disabled) { color: var(--text); border-color: var(--accent); }
.cr-page-btn:disabled { opacity: .3; cursor: default; }
.cr-page-counter { font-size: 13px; color: var(--muted); font-family: var(--fh); font-weight: 600; }

/* ── responsive ── */
@media (max-width: 640px) {
  .cr-game-layout { grid-template-columns: 1fr; padding: 20px 16px; }
  .cr-timer-col { flex-direction: row; flex-wrap: wrap; justify-content: center; gap: 14px; }
  .cr-timer-ring { width: 120px; height: 120px; }
  .cr-timer-digits { font-size: 24px; }
  .cr-question-text { font-size: 17px; }
  .cr-intro-card, .cr-switch-card, .cr-finish-card { padding: 28px 20px; }
  .cr-review-card { padding: 20px 16px; }
  .cr-finish-actions { flex-direction: column; }
}
`;
