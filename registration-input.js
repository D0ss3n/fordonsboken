(() => {
  const normalizeRegistration = input => {
    if (!input || input.value === input.value.toLocaleUpperCase('sv-SE')) return;
    const start = input.selectionStart;
    const end = input.selectionEnd;
    input.value = input.value.toLocaleUpperCase('sv-SE');
    if (start !== null && end !== null) input.setSelectionRange(start, end);
  };

  document.addEventListener('input', event => {
    const input = event.target.closest('input[name="reg"]');
    if (input) normalizeRegistration(input);
  });

  document.addEventListener('focusin', event => {
    const input = event.target.closest('input[name="reg"]');
    if (input) normalizeRegistration(input);
  });

  document.addEventListener('submit', event => {
    const input = event.target.querySelector('input[name="reg"]');
    if (input) input.value = input.value.toLocaleUpperCase('sv-SE');
  }, true);
})();
