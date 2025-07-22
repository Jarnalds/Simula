// Variables globales para el estado del juego (en memoria del script)
var SERVER_STATE = {
  active: false,
  gameStatus: 'WAITING', // WAITING, IN_PROGRESS, GAME_OVER
  currentQuestionIndex: 0, // Ronda actual
  players: {}, // { playerName: { name, position, score, registeredAt } }
  questions: [], // Array con todas las preguntas (objeto con round, questionNumber, position, question, options, correctAnswer)
  responses: {}, // { roundNumber: [ { player, position, answer, isCorrect } ] }
};

// ==========================
// Configuración inicial
// ==========================

function onOpen() {
  // Solo si usas menú personalizado para abrir el host, no obligatorio
  SpreadsheetApp.getUi().createMenu('Mini Kahoot')
    .addItem('Abrir Anfitrión', 'openHost')
    .addToUi();
}

function openHost() {
  var html = HtmlService.createHtmlOutputFromFile('host')
    .setWidth(700)
    .setHeight(600);
  SpreadsheetApp.getUi().showModalDialog(html, 'Mini Kahoot - Anfitrión');
}

// ==========================
// Lógica de preguntas (Ejemplo estático)
// ==========================

function loadQuestions() {
  // Ejemplo: preguntas precargadas, pueden venir de una hoja o base externa
  SERVER_STATE.questions = [
    // round, questionNumber, position, question, options, correctAnswer
    { round: 1, questionNumber: 1, position: 'A', question: '¿Capital de México?', options: ['Ciudad de México', 'Guadalajara', 'Monterrey', 'Puebla'], correctAnswer: 'A' },
    { round: 1, questionNumber: 1, position: 'B', question: '¿Capital de Francia?', options: ['París', 'Lyon', 'Marsella', 'Niza'], correctAnswer: 'A' },
    { round: 1, questionNumber: 1, position: 'C', question: '¿Capital de España?', options: ['Madrid', 'Barcelona', 'Valencia', 'Sevilla'], correctAnswer: 'A' },
    // Ronda 2
    { round: 2, questionNumber: 2, position: 'A', question: '¿2 + 2?', options: ['3', '4', '5', '6'], correctAnswer: 'B' },
    { round: 2, questionNumber: 2, position: 'B', question: '¿3 * 3?', options: ['6', '7', '8', '9'], correctAnswer: 'D' },
    { round: 2, questionNumber: 2, position: 'C', question: '¿10 / 2?', options: ['2', '3', '4', '5'], correctAnswer: 'D' },
  ];
}

// ==========================
// Funciones servidor-clientes
// ==========================

// Activa o desactiva el servidor
function setServerStatus(status) {
  SERVER_STATE.active = status;
  if (status) {
    SERVER_STATE.gameStatus = 'WAITING';
    SERVER_STATE.currentQuestionIndex = 0;
    if (SERVER_STATE.questions.length === 0) {
      loadQuestions();
    }
  } else {
    SERVER_STATE.gameStatus = 'WAITING';
  }
  return status ? "Servidor Activado." : "Servidor Desactivado.";
}

// Registro de jugador
function registerPlayer(name, position) {
  if (!SERVER_STATE.active) {
    return { success: false, message: "El servidor no está activo. No puedes unirte." };
  }
  if (!name || !position) {
    return { success: false, message: "Nombre y posición son requeridos." };
  }
  if (SERVER_STATE.players[name]) {
    return { success: false, message: "Nombre de jugador ya registrado." };
  }
  // Registrar jugador
  SERVER_STATE.players[name] = {
    name: name,
    position: position,
    score: 0,
    registeredAt: new Date(),
  };
  return { success: true, playerName: name, position: position, score: 0 };
}

// Obtener todas las preguntas para la posición de un jugador
function getAllQuestionsForPlayerPosition(position) {
  if (!SERVER_STATE.active) {
    return { error: true, message: "El servidor no está activo." };
  }
  if (!position) {
    return { error: true, message: "Posición no especificada." };
  }
  var filteredQuestions = SERVER_STATE.questions
    .filter(q => q.position === position)
    .map(q => ({
      round: q.round,
      questionNumber: q.questionNumber,
      question: q.question,
      options: q.options,
      correctAnswer: q.correctAnswer
    }));
  return filteredQuestions;
}

// Obtener estado general del juego (para jugadores y host)
function getGameStatus() {
  return {
    serverActive: SERVER_STATE.active,
    gameStatus: SERVER_STATE.gameStatus,
    currentQuestionIndex: SERVER_STATE.currentQuestionIndex,
    players: Object.values(SERVER_STATE.players),
    // Opcional: respuestas actuales de la ronda para host
    currentRoundResponses: SERVER_STATE.responses[SERVER_STATE.currentQuestionIndex] || [],
  };
}

// Iniciar el juego (desde host)
function startGame() {
  if (!SERVER_STATE.active) return "Servidor no activo.";
  if (SERVER_STATE.gameStatus === 'IN_PROGRESS') return "El juego ya está en progreso.";
  SERVER_STATE.gameStatus = 'IN_PROGRESS';
  SERVER_STATE.currentQuestionIndex = 1;
  SERVER_STATE.responses = {}; // Limpiar respuestas previas
  // Reiniciar puntuaciones
  Object.values(SERVER_STATE.players).forEach(p => p.score = 0);
  return "Juego iniciado. Ronda 1 activada.";
}

// Avanzar a la siguiente pregunta (desde host)
function getNextQuestion() {
  if (!SERVER_STATE.active) return { success: false, message: "Servidor no activo." };
  if (SERVER_STATE.gameStatus !== 'IN_PROGRESS') return { success: false, message: "El juego no está en progreso." };
  var nextRound = SERVER_STATE.currentQuestionIndex + 1;
  // Verificar si hay preguntas para la siguiente ronda
  var hasQuestions = SERVER_STATE.questions.some(q => q.round === nextRound);
  if (hasQuestions) {
    SERVER_STATE.currentQuestionIndex = nextRound;
    SERVER_STATE.responses[nextRound] = [];
    return { success: true, message: `Ronda ${nextRound} iniciada.` };
  } else {
    SERVER_STATE.gameStatus = 'GAME_OVER';
    return { success: false, message: "No hay más preguntas. El juego ha terminado." };
  }
}

// Registrar respuestas del jugador al final del juego
function recordPlayerFinalResults(playerName, responses, finalScore, roundsCompleted) {
  if (!playerName || !responses) {
    return { success: false, message: "Datos incompletos para registrar resultados." };
  }
  if (!SERVER_STATE.players[playerName]) {
    return { success: false, message: "Jugador no registrado." };
  }
  // Actualizar puntuación final del jugador
  SERVER_STATE.players[playerName].score = finalScore;

  // Guardar respuestas por ronda (opcional, aquí simplemente agregamos)
  responses.forEach(resp => {
    if (!SERVER_STATE.responses[resp.round]) SERVER_STATE.responses[resp.round] = [];
    SERVER_STATE.responses[resp.round].push({
      player: playerName,
      position: SERVER_STATE.players[playerName].position,
      answer: resp.selectedAnswer,
      isCorrect: resp.isCorrect
    });
  });
  return { success: true, message: "Resultados registrados para " + playerName };
}

// Resetear juego manteniendo jugadores (borra respuestas y puntuaciones)
function resetGame() {
  SERVER_STATE.gameStatus = 'WAITING';
  SERVER_STATE.currentQuestionIndex = 0;
  SERVER_STATE.responses = {};
  Object.values(SERVER_STATE.players).forEach(p => p.score = 0);
  return "Juego reiniciado. Jugadores conservados.";
}

// Resetear servidor y jugadores (borrar todo)
function resetServerAndPlayers() {
  SERVER_STATE.active = false;
  SERVER_STATE.gameStatus = 'WAITING';
  SERVER_STATE.currentQuestionIndex = 0;
  SERVER_STATE.players = {};
  SERVER_STATE.responses = {};
  SERVER_STATE.questions = [];
  return "Servidor y jugadores reiniciados. Todo borrado.";
}
