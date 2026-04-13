import ChallengeRoom from './ChallengeRoom';
import questions from './questions.json';

function App() {
  // هذا تعريف بسيط للمستخدم لتجربة الموقع
  const demoUser = { uid: "user123", displayName: "Dhaif" };

  return (
    <div className="App">
      <ChallengeRoom 
        roomId="test-room-1" 
        currentUser={demoUser} 
        questions={questions} 
        onExit={() => alert('Exit Clicked')} 
      />
    </div>
  );
}

export default App;