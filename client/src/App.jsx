import { useEffect, useState } from 'react';
import { api, setUnauthorizedHandler } from './api.js';
import { useRoute } from './lib.js';
import { Dashboard } from './components/Dashboard.jsx';
import { EditorPage } from './components/EditorPage.jsx';
import { Login } from './components/Login.jsx';
import { Logo } from './components/ui.jsx';

export default function App() {
  const [user, setUser] = useState(undefined); // undefined = still checking the session
  const route = useRoute();

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
    api
      .me()
      .then((r) => setUser(r.user))
      .catch(() => setUser(null));
  }, []);

  useEffect(() => {
    if (route.name === 'home') document.title = 'Documents – Inkwell';
  }, [route.name]);

  if (user === undefined) {
    return (
      <div className="splash">
        <Logo />
      </div>
    );
  }
  if (!user) return <Login onLogin={setUser} />;
  if (route.name === 'doc') {
    return <EditorPage key={route.id} id={route.id} user={user} onUserChange={setUser} />;
  }
  return <Dashboard user={user} onUserChange={setUser} />;
}
