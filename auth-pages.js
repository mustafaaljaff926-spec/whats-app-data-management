(function () {
  const TOKEN_KEY = 'fuel-orders-token';
  const ROLE_KEY = 'fuel-orders-role';
  const page = document.body.getAttribute('data-auth-page') || 'login';
  let stateTeamLogin = false;
  let stateUserLogin = false;

  function appHome() {
    try {
      return new URL('./index.html', location.href).href;
    } catch (e) {
      return './index.html';
    }
  }

  function toast(msg, variant) {
    const host = document.getElementById('toastHost');
    if (!host) return;
    const el = document.createElement('div');
    el.className = 'toast toast-' + (variant || 'info');
    el.textContent = msg;
    host.appendChild(el);
    requestAnimationFrame(function () {
      el.classList.add('toast-visible');
    });
    setTimeout(function () {
      el.classList.remove('toast-visible');
      setTimeout(function () {
        el.remove();
      }, 280);
    }, 4000);
  }

  function show(el, on) {
    if (!el) return;
    el.classList.toggle('hidden', !on);
  }

  async function boot() {
    let st = { authEnabled: false };
    try {
      st = await fetch('/api/auth/status').then(function (r) {
        return r.json();
      });
    } catch (e) {}

    const openOnly = document.getElementById('authOpenOnly');
    const mainForms = document.getElementById('authPageMain');

    if (!st.authEnabled) {
      show(openOnly, true);
      show(mainForms, false);
      return;
    }
    show(openOnly, false);
    show(mainForms, true);

    var teamLogin = !!st.teamLoginEnabled;
    var userLogin = !!st.userLoginEnabled;
    var signupOn = !!st.signupEnabled;
    var resetOn = !!st.passwordResetEnabled;
    stateTeamLogin = teamLogin;
    stateUserLogin = userLogin;

    if (page === 'signup') {
      if (!signupOn) {
        var disabled = document.getElementById('signupDisabled');
        var signupCard = document.getElementById('signupCard');
        show(disabled, true);
        show(signupCard, false);
        return;
      }
      return;
    }

    var userBlock = document.getElementById('loginEmailBlock');
    var hint = document.getElementById('loginPageHint');
    var emailInput = document.getElementById('loginEmail');
    if (userBlock) {
      userBlock.classList.toggle('hidden', !userLogin);
      if (emailInput) emailInput.required = !!(userLogin && !teamLogin);
    }
    if (hint) {
      if (userLogin && teamLogin) {
        hint.textContent =
          'Use your email and password, or leave email empty and use the shared team password.';
      } else if (userLogin) {
        hint.textContent = 'Sign in with the email and password you registered.';
      } else if (teamLogin) {
        hint.textContent = 'Enter the team password from your administrator.';
      } else {
        hint.textContent = '';
      }
    }
    var linkSu = document.getElementById('loginLinkSignup');
    if (linkSu) linkSu.classList.toggle('hidden', !signupOn);
    var linkForgot = document.getElementById('loginLinkForgot');
    if (linkForgot) linkForgot.classList.toggle('hidden', !(userLogin && resetOn));
  }

  async function doLogin() {
    var err = document.getElementById('loginError');
    var btn = document.getElementById('btnLoginSubmit');
    var em = document.getElementById('loginEmail');
    var pw = document.getElementById('loginPassword');
    if (err) {
      err.style.display = 'none';
      err.textContent = '';
    }
    var email = em && em.value ? em.value.trim().toLowerCase() : '';
    var password = pw ? pw.value : '';
    if (stateUserLogin && !stateTeamLogin && !email) {
      toast('Email is required.', 'error');
      if (err) {
        err.textContent = 'Email is required';
        err.style.display = 'block';
      }
      return;
    }
    if (!password) {
      toast('Enter a password.', 'error');
      return;
    }
    if (btn) {
      btn.disabled = true;
      btn.dataset._t = btn.textContent;
      btn.textContent = 'Signing in…';
    }
    try {
      var body = email ? { email: email, password: password } : { password: password };
      var res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        if (err) {
          err.textContent = 'Invalid credentials';
          err.style.display = 'block';
        }
        toast('Invalid credentials', 'error');
        return;
      }
      var data = await res.json();
      localStorage.setItem(TOKEN_KEY, data.token);
      localStorage.setItem(ROLE_KEY, data.role === 'viewer' ? 'viewer' : 'editor');
      location.href = appHome();
    } catch (e) {
      toast('Network error — check your connection.', 'error');
      if (err) {
        err.textContent = 'Network error';
        err.style.display = 'block';
      }
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = btn.dataset._t || 'Sign in';
      }
    }
  }

  async function doSignup() {
    var err = document.getElementById('signupError');
    var btn = document.getElementById('btnSignupSubmit');
    if (err) {
      err.style.display = 'none';
      err.textContent = '';
    }
    var emailEl = document.getElementById('signupEmail');
    var p1 = document.getElementById('signupPassword');
    var p2 = document.getElementById('signupPassword2');
    var codeEl = document.getElementById('signupCode');
    var email = emailEl ? emailEl.value.trim().toLowerCase() : '';
    var password = p1 ? p1.value : '';
    var signupCode = codeEl ? codeEl.value : '';
    if (password !== (p2 ? p2.value : '')) {
      if (err) {
        err.textContent = 'Passwords do not match';
        err.style.display = 'block';
      }
      return;
    }
    if (btn) {
      btn.disabled = true;
      btn.dataset._t = btn.textContent;
      btn.textContent = 'Creating…';
    }
    try {
      var res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email, password: password, signupCode: signupCode }),
      });
      var data = {};
      try {
        data = await res.json();
      } catch (e) {}
      if (!res.ok) {
        var msg = data.error || 'Registration failed';
        if (err) {
          err.textContent = msg;
          err.style.display = 'block';
        }
        toast(msg, 'error');
        return;
      }
      toast('Account created — sign in.', 'success');
      location.href = new URL('./login.html', location.href).href;
    } catch (e) {
      toast('Network error.', 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = btn.dataset._t || 'Create account';
      }
    }
  }

  async function doForgot() {
    var err = document.getElementById('forgotError');
    var ok = document.getElementById('forgotSuccess');
    var btn = document.getElementById('btnForgotSubmit');
    var em = document.getElementById('forgotEmail');
    if (err) {
      err.style.display = 'none';
      err.textContent = '';
    }
    if (ok) {
      ok.style.display = 'none';
      ok.textContent = '';
    }
    var email = em ? em.value.trim().toLowerCase() : '';
    if (!email) {
      if (err) {
        err.textContent = 'Enter your email.';
        err.style.display = 'block';
      }
      return;
    }
    if (btn) {
      btn.disabled = true;
      btn.dataset._t = btn.textContent;
      btn.textContent = 'Sending…';
    }
    try {
      var res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email }),
      });
      var data = {};
      try {
        data = await res.json();
      } catch (e) {}
      var msg = data.message || 'If that email is registered, you will receive reset instructions shortly.';
      if (ok) {
        ok.textContent = msg;
        ok.style.display = 'block';
      }
      toast(msg, 'success');
    } catch (e) {
      toast('Network error.', 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = btn.dataset._t || 'Send reset link';
      }
    }
  }

  function showLoginPanel() {
    show(document.getElementById('loginCard'), true);
    show(document.getElementById('forgotCard'), false);
  }

  function showForgotPanel() {
    show(document.getElementById('loginCard'), false);
    show(document.getElementById('forgotCard'), true);
  }

  window.authPageLogin = doLogin;
  window.authPageSignup = doSignup;
  window.authPageForgot = doForgot;
  window.authPageShowLogin = showLoginPanel;
  window.authPageShowForgot = showForgotPanel;

  document.addEventListener('DOMContentLoaded', boot);
})();
