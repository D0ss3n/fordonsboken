import { firebaseConfig } from './firebase-config.js?v=storage-sync-20261006';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import { getAuth, verifyPasswordResetCode, confirmPasswordReset, checkActionCode, applyActionCode } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';

const $ = selector => document.querySelector(selector);
const params = new URLSearchParams(location.search);
const actionCode = params.get('oobCode');
const auth = getAuth(initializeApp(firebaseConfig));
const loading = $('#reset-loading');
const formSection = $('#reset-form-section');
const resultSection = $('#reset-result');
const errorNotice = $('#reset-error');
const resetForm = $('#reset-form');
let verifiedEmail = '';

function showError(message) {
  loading.hidden = true;
  formSection.hidden = true;
  resultSection.hidden = true;
  errorNotice.textContent = message;
  errorNotice.hidden = false;
}

function firebaseMessage(error) {
  const messages = {
    'auth/expired-action-code': 'Återställningslänken har gått ut. Begär en ny länk från inloggningssidan.',
    'auth/invalid-action-code': 'Återställningslänken är ogiltig eller redan använd. Begär en ny länk från inloggningssidan.',
    'auth/weak-password': 'Välj ett starkare lösenord med minst 6 tecken.',
    'auth/network-request-failed': 'Det gick inte att ansluta. Kontrollera internetanslutningen och försök igen.',
  };
  return messages[error?.code] || 'Lösenordet kunde inte återställas. Begär en ny återställningslänk och försök igen.';
}

async function showSuccess(title, message) {
  loading.hidden = true;
  formSection.hidden = true;
  errorNotice.hidden = true;
  $('#result-title').textContent = title;
  $('#result-message').textContent = message;
  resultSection.hidden = false;
  history.replaceState(null, document.title, location.pathname);
}

if (!actionCode || !firebaseConfig.apiKey) {
  showError('Länken saknar information eller är ogiltig. Gå tillbaka till Fordonsmappen och begär en ny länk.');
} else {
  try {
    const mode = params.get('mode');
    if (mode === 'resetPassword') {
      verifiedEmail = await verifyPasswordResetCode(auth, actionCode);
      $('#reset-email').textContent = `Återställ lösenordet för ${verifiedEmail}.`;
      loading.hidden = true;
      formSection.hidden = false;
      // Keep the one-time code in memory, not in browser history or the address bar.
      history.replaceState(null, document.title, location.pathname);
      $('#new-password').focus({ preventScroll: true });
    } else if (mode === 'verifyEmail') {
      await applyActionCode(auth, actionCode);
      await showSuccess('E-postadressen är verifierad', 'Du kan nu fortsätta använda Fordonsmappen.');
    } else if (mode === 'recoverEmail') {
      await checkActionCode(auth, actionCode);
      await applyActionCode(auth, actionCode);
      await showSuccess('E-postadressen är återställd', 'Ändringen av e-postadressen har ångrats.');
    } else {
      showError('Länken är ogiltig eller stöds inte. Öppna den senaste länken från Fordonsmappen.');
    }
  } catch (error) {
    showError(firebaseMessage(error));
  }
}

resetForm.addEventListener('submit', async event => {
  event.preventDefault();
  const password = $('#new-password').value;
  const confirmation = $('#confirm-password').value;
  if (password.length < 6) {
    $('#new-password').setCustomValidity('Lösenordet måste innehålla minst 6 tecken.');
    $('#new-password').reportValidity();
    $('#new-password').setCustomValidity('');
    return;
  }
  if (password !== confirmation) {
    $('#confirm-password').setCustomValidity('Lösenorden matchar inte.');
    $('#confirm-password').reportValidity();
    $('#confirm-password').setCustomValidity('');
    return;
  }
  const submit = resetForm.querySelector('[type="submit"]');
  submit.disabled = true;
  submit.textContent = 'Sparar…';
  try {
    await confirmPasswordReset(auth, actionCode, password);
    formSection.hidden = true;
    errorNotice.hidden = true;
    $('#result-title').textContent = 'Lösenordet är ändrat';
    $('#result-message').textContent = 'Du kan nu logga in i Fordonsmappen med ditt nya lösenord.';
    resultSection.hidden = false;
  } catch (error) {
    submit.disabled = false;
    submit.textContent = 'Spara nytt lösenord';
    errorNotice.textContent = firebaseMessage(error);
    errorNotice.hidden = false;
  }
});