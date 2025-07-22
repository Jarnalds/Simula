// --- CONFIGURACIÓN GLOBAL ---
// ¡IMPORTANTE! Reemplaza 'TU_ID_DE_HOJA_DE_CALCULO' con el ID real de tu hoja de cálculo.
// Ya tienes el ID configurado: '16EFMae-pDA4fvrdzW3hsyb0M8A_cZovKivVueAJadaw', lo mantengo.
const SPREADSHEET_ID = '16EFMae-pDA4fvrdzW3hsyb0M8A_cZovKivVueAJadaw';
const CONFIG_SHEET_NAME = 'Config';
const QUESTIONS_SHEET_NAME = 'Preguntas';
const RESPONSES_SHEET_NAME = 'Respuestas';
const PLAYERS_SHEET_NAME = 'Jugadores';
const HISTORY_SHEET_NAME = 'Historial';

// --- FUNCIONES DE SERVICIO WEB (doGet y include) ---

/**
 * Sirve el archivo HTML apropiado basado en el parámetro de URL.
 * Utilizado tanto para la interfaz del jugador como del anfitrión.
 * @param {GoogleAppsScript.Events.DoGet} e El objeto de evento que contiene los parámetros de URL.
 * @returns {GoogleAppsScript.HTML.HtmlOutput} El contenido HTML a mostrar.
 */
function doGet(e) {
  if (e && e.parameter && e.parameter.path === 'host') {
    return HtmlService.createTemplateFromFile('host')
      .evaluate()
      .setTitle('Mini Kahoot - Anfitrión')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL); // Permite la incrustación si es necesario
  } else {
    return HtmlService.createTemplateFromFile('index')
      .evaluate()
      .setTitle('Mini Kahoot - Jugador')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL); // Permite la incrustación si es necesario
  }
}

/**
 * Incluye el contenido de un archivo HTML dentro de otro.
 * Utilizado en plantillas HTML como index.html y host.html (ej: <?!= include('Style'); ?>).
 * @param {string} filename El nombre del archivo HTML a incluir (sin .html).
 * @returns {string} El contenido HTML del archivo incluido.
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename)
      .getContent();
}

// --- FUNCIONES DE UTILIDAD INTERNAS Y GESTIÓN DE HOJAS ---

/**
 * Obtiene la hoja de cálculo por su nombre. Si no existe, la crea con encabezados básicos.
 * @param {string} sheetName El nombre de la hoja.
 * @param {Array<string>} headers Los encabezados a usar si la hoja es nueva.
 * @returns {GoogleAppsScript.Spreadsheet.Sheet} La hoja de cálculo.
 */
function getOrCreateSheet(sheetName, headers) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    if (headers && headers.length > 0) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    }
    SpreadsheetApp.flush(); // Asegura que los cambios se apliquen inmediatamente
  }
  return sheet;
}

/**
 * Recupera el estado actual del juego de la hoja 'Config'.
 * Si la hoja o los valores no existen, los inicializa.
 * @returns {object} Un objeto que contiene gameStatus, currentQuestionIndex y serverActive.
 */
function getGameStatus() {
  const configSheet = getOrCreateSheet(CONFIG_SHEET_NAME, ['Clave', 'Valor']);
  
  // Asegurarse de que las celdas de configuración existan e inicializarlas si no lo hacen.
  // Estado: B1, RondaActual: B2, ServerActivo: B3
  const range = configSheet.getRange('A1:B3');
  const values = range.getValues();

  // Inicializar si las celdas están vacías o no tienen los valores esperados
  if (values[0][0] !== 'Estado' || values[1][0] !== 'RondaActual' || values[2][0] !== 'ServerActivo') {
      configSheet.clearContents(); // Limpiar si los encabezados están mal
      configSheet.getRange('A1').setValue('Estado');
      configSheet.getRange('A2').setValue('RondaActual');
      configSheet.getRange('A3').setValue('ServerActivo');
      configSheet.getRange('B1').setValue('WAITING');
      configSheet.getRange('B2').setValue(0);
      configSheet.getRange('B3').setValue(false);
      SpreadsheetApp.flush();
      // Leer los valores recién inicializados
      return { 
          gameStatus: 'WAITING', 
          currentQuestionIndex: 0, 
          serverActive: false 
      };
  }

  return { 
    gameStatus: values[0][1], 
    currentQuestionIndex: Number(values[1][1]) || 0, // Asegura que sea un número
    serverActive: values[2][1] === true // Asegura que sea un booleano
  };
}

/**
 * Actualiza el estado del juego en la hoja 'Config'.
 * Esta función es típicamente llamada por el anfitrión.
 * @param {string} status El nuevo estado del juego ('WAITING', 'IN_PROGRESS', 'GAME_OVER').
 * @param {number} questionIndex La ronda actual o índice de la pregunta global.
 */
function updateGameStatus(status, questionIndex) {
  const configSheet = getOrCreateSheet(CONFIG_SHEET_NAME);
  configSheet.getRange('B1').setValue(status);
  configSheet.getRange('B2').setValue(questionIndex);
}

/**
 * Establece el estado activo del servidor del juego.
 * Esta función es típicamente llamada por el anfitrión.
 * @param {boolean} active Verdadero para activar el servidor, falso para desactivar.
 * @returns {string} Un mensaje de confirmación.
 */
function setServerStatus(active) {
  const configSheet = getOrCreateSheet(CONFIG_SHEET_NAME);
  configSheet.getRange('B3').setValue(active);
  if (!active) {
    updateGameStatus('WAITING', 0); // Reinicia el estado del juego cuando el servidor se apaga
    return 'Servidor apagado. El juego está inactivo.';
  }
  return 'Servidor encendido. El juego está listo para iniciar o reanudar.';
}

/**
 * Elimina a todos los jugadores registrados de la hoja de jugadores,
 * dejando solo la fila de encabezado.
 * @returns {string} Un mensaje de confirmación.
 */
function clearAllPlayers() {
  const playersSheet = getOrCreateSheet(PLAYERS_SHEET_NAME, ['NombreJugador', 'Puntuacion', 'Posicion', 'RondaActual']);
  if (playersSheet.getLastRow() > 1) {
    playersSheet.deleteRows(2, playersSheet.getLastRow() - 1);
  }
  return 'Todos los jugadores han sido eliminados de la lista.';
}

/**
 * Recupera una lista de todos los jugadores registrados con sus puntuaciones, posiciones y rondas actuales.
 * @returns {Array<object>} Un array de objetos de jugador.
 */
function getPlayers() {
  const playersSheet = getOrCreateSheet(PLAYERS_SHEET_NAME, ['NombreJugador', 'Puntuacion', 'Posicion', 'RondaActual']);
  const data = playersSheet.getDataRange().getValues();
  if (data.length <= 1) return []; // No jugadores si solo existe la fila de encabezado
  return data.slice(1).map(row => ({ name: row[0], score: row[1], position: row[2], currentRound: row[3] || 0 }));
}

/**
 * Registra un nuevo jugador si el servidor está activo y el nombre no está tomado.
 * @param {string} playerName El nombre del jugador.
 * @param {string} playerPosition La posición elegida (ej., 'A', 'B', 'C').
 * @returns {object} Un objeto que indica éxito/fallo y un mensaje.
 */
function registerPlayer(playerName, playerPosition) {
  const gameStatus = getGameStatus();
  if (!gameStatus.serverActive) {
    return { success: false, message: 'El servidor del juego está actualmente inactivo. Inténtalo de nuevo más tarde.' };
  }

  const playersSheet = getOrCreateSheet(PLAYERS_SHEET_NAME, ['NombreJugador', 'Puntuacion', 'Posicion', 'RondaActual']);
  const players = playersSheet.getDataRange().getValues();
  
  // Verificar si el nombre del jugador ya existe
  for (let i = 1; i < players.length; i++) {
    if (players[i][0] === playerName) {
      // Si el jugador ya existe, solo confirmamos su unión y actualizamos la posición si es diferente.
      if (players[i][2] !== playerPosition) {
          playersSheet.getRange(i + 1, 3).setValue(playerPosition); // Actualiza la columna de posición
      }
      return { success: true, message: `Bienvenido de nuevo, ${playerName} (${playerPosition})!`, score: players[i][1] };
    }
  }

  // Opcional: Verificar si la posición ya está tomada (descomenta si las posiciones deben ser únicas)
  /*
  for (let i = 1; i < players.length; i++) {
      if (players[i][2] === playerPosition) { // Verificar la columna de posición (índice 2)
          return { success: false, message: `La posición '${playerPosition}' ya está ocupada. Por favor, elige otra.` };
      }
  }
  */

  // Añadir nuevo jugador a la hoja con puntuación y ronda iniciales
  playersSheet.appendRow([playerName, 0, playerPosition, 0]); 
  return { success: true, message: `¡Hola, ${playerName} (${playerPosition})! Esperando que el anfitrión inicie el juego...`, score: 0 };
}

/**
 * Inicia el juego estableciendo su estado a 'IN_PROGRESS'.
 * Solo puede ser llamado por el anfitrión cuando el servidor está activo.
 * @returns {string} Un mensaje de confirmación o error.
 */
function startGame() {
  const gameStatus = getGameStatus();
  if (!gameStatus.serverActive) {
    return 'Error: El servidor del juego está inactivo. Primero enciéndelo.';
  }
  updateGameStatus('IN_PROGRESS', 1); // Establece el juego en progreso, comenzando en la ronda 1
  return 'Juego iniciado. Los jugadores pueden comenzar.';
}

/**
 * Avanza la ronda global del juego.
 * Esto señala a los jugadores la progresión o el fin del juego.
 * @returns {object} Un objeto que indica éxito/fallo, nuevo número de ronda y un mensaje.
 */
function getNextQuestion() {
  const gameStatus = getGameStatus();
  if (!gameStatus.serverActive) {
    return { success: false, message: 'Error: El servidor del juego está inactivo. No se puede avanzar de ronda.' };
  }

  const configSheet = getOrCreateSheet(CONFIG_SHEET_NAME);
  let currentGlobalRound = Number(configSheet.getRange('B2').getValue()) || 0;
  currentGlobalRound++;

  const questionsSheet = getOrCreateSheet(QUESTIONS_SHEET_NAME, ['ID', 'Ronda', 'Pregunta', 'OpcionA', 'OpcionB', 'OpcionC', 'OpcionD', 'RespuestaCorrecta', 'Posicion']);
  const allQuestions = questionsSheet.getDataRange().getValues();
  
  if (allQuestions.length <= 1) { // Solo la fila de encabezado
      updateGameStatus('GAME_OVER', currentGlobalRound - 1); // No hay preguntas, termina el juego
      return { success: false, message: "No hay preguntas cargadas en la hoja 'Preguntas'." };
  }

  // Filtrar preguntas para la ronda actual global
  // Asumiendo que 'Ronda' está en la columna B (índice 1)
  const questionsForThisRound = allQuestions.slice(1).filter(row => Number(row[1]) === currentGlobalRound); 
  
  Logger.log(`DEBUG: currentGlobalRound: ${currentGlobalRound}, Questions for this round: ${questionsForThisRound.length}`); 
  
  if (questionsForThisRound.length > 0) {
    // Actualiza la hoja de configuración con el nuevo número de ronda
    configSheet.getRange('B2').setValue(currentGlobalRound);
    return { success: true, newRound: currentGlobalRound, message: `Anfitrión: Ronda ${currentGlobalRound} activa.` };
  } else {
    // Si no hay más preguntas para esta o las siguientes rondas
    updateGameStatus('GAME_OVER', currentGlobalRound - 1); // Usa la ronda anterior como la última completada
    Logger.log('DEBUG: Game status set to GAME_OVER'); 
    return { success: false, message: '¡Fin del juego! Todas las rondas han sido lanzadas o no hay más preguntas.' };
  }
}

/**
 * Recupera todas las preguntas relevantes para la posición de un jugador.
 * Esta función es llamada una vez por el cliente jugador al unirse, para el almacenamiento en caché del lado del cliente.
 * @param {string} playerPosition La posición (ej., 'A', 'B', 'C') para filtrar las preguntas.
 * @returns {Array<object>} Un array de objetos de pregunta, cada uno incluyendo la respuesta correcta.
 */
function getAllQuestionsForPlayerPosition(playerPosition) {
  const gameStatus = getGameStatus();
  if (!gameStatus.serverActive) {
    return { error: true, message: 'El servidor del juego está inactivo.' };
  }

  const questionsSheet = getOrCreateSheet(QUESTIONS_SHEET_NAME, ['ID', 'Ronda', 'Pregunta', 'OpcionA', 'OpcionB', 'OpcionC', 'OpcionD', 'RespuestaCorrecta', 'Posicion']);
  const allQuestions = questionsSheet.getDataRange().getValues();
  
  const playerQuestions = [];
  // Iterar a través de los datos de las preguntas, omitiendo la fila de encabezado (índice 0)
  for (let i = 1; i < allQuestions.length; i++) {
    const row = allQuestions[i];
    // Asumiendo la estructura: ID, Ronda, Pregunta, OpcionA, OpcionB, OpcionC, OpcionD, RespuestaCorrecta, Posicion
    // Columna 'Posicion' es el índice 8
    // Columna 'Ronda' es el índice 1
    // Columna 'Pregunta' es el índice 2
    // Opciones A-D son los índices 3,4,5,6
    // RespuestaCorrecta es el índice 7

    if (row[8] === playerPosition) { // Verificación correcta: Columna Posicion (índice 8)
      playerQuestions.push({
        questionNumber: row[0], // ID de la pregunta, actúa como número de pregunta
        round: Number(row[1]) || 0, // La ronda a la que pertenece esta pregunta
        question: row[2],        
        options: [row[3], row[4], row[5], row[6]].filter(o => o !== ''), // Filtra las opciones vacías
        correctAnswer: row[7]    
      });
    }
  }
  // Ordena las preguntas por su número de ronda y luego por el número de pregunta para asegurar el orden correcto
  playerQuestions.sort((a, b) => {
      if (a.round !== b.round) {
          return a.round - b.round;
      }
      return a.questionNumber - b.questionNumber;
  });
  Logger.log(`DEBUG: Player ${playerPosition} questions: ${JSON.stringify(playerQuestions.map(q => q.questionNumber + " (Ronda " + q.round + ")"))}`); 
  return playerQuestions;
}

/**
 * Registra todas las respuestas almacenadas en caché del jugador y actualiza la puntuación final del jugador y la última ronda completada.
 * Esta función es llamada por el cliente jugador al final de su juego local.
 * @param {string} playerName El nombre del jugador.
 * @param {Array<object>} clientResponses Un array de objetos de respuesta de la caché del cliente.
 * @param {number} finalScore La puntuación final del jugador calculada por el cliente.
 * @param {number} lastRoundCompleted La última ronda de preguntas que el jugador completó.
 * @returns {boolean} Verdadero si el registro fue exitoso.
 */
function recordPlayerFinalResults(playerName, clientResponses, finalScore, lastRoundCompleted) {
  const responsesSheet = getOrCreateSheet(RESPONSES_SHEET_NAME, ['Timestamp', 'Jugador', 'ID_Pregunta', 'Respuesta', 'EsCorrecta', 'PuntuacionGanada', 'Posicion']);
  const playersSheet = getOrCreateSheet(PLAYERS_SHEET_NAME, ['NombreJugador', 'Puntuacion', 'Posicion', 'RondaActual']);

  // Registrar cada respuesta de la caché del cliente
  const timestamp = new Date();
  clientResponses.forEach(response => {
    responsesSheet.appendRow([
      timestamp,
      playerName,
      response.questionNumber, // Este es en realidad el ID de la pregunta
      response.selectedAnswer,
      response.isCorrect,
      response.scoreGained,
      response.playerPosition
    ]);
  });

  // Actualizar la puntuación final del jugador y la última ronda completada en la hoja de jugadores
  const playersData = playersSheet.getDataRange().getValues();
  let playerRowIndex = -1;
  for (let i = 1; i < playersData.length; i++) {
    if (playersData[i][0] === playerName) {
      playerRowIndex = i;
      break;
    }
  }

  if (playerRowIndex !== -1) {
    playersSheet.getRange(playerRowIndex + 1, 2).setValue(finalScore); // Puntuacion está en la columna B (índice 1)
    playersSheet.getRange(playerRowIndex + 1, 4).setValue(lastRoundCompleted); // RondaActual está en la columna D (índice 3)
    return true;
  }
  Logger.log(`Error: Jugador ${playerName} no encontrado para actualizar la puntuación final y la ronda.`);
  return false;
}

/**
 * Recupera la puntuación de un jugador específico.
 * @param {string} playerName El nombre del jugador.
 * @returns {number} La puntuación del jugador, o 0 si no se encuentra.
 */
function getPlayerScore(playerName) {
  const playersSheet = getOrCreateSheet(PLAYERS_SHEET_NAME, ['NombreJugador', 'Puntuacion', 'Posicion', 'RondaActual']);
  const playersData = playersSheet.getDataRange().getValues();
  
  for (let i = 1; i < playersData.length; i++) {
    if (playersData[i][0] === playerName) {
      return playersData[i][1]; // La puntuación está en la columna B (índice 1)
    }
  }
  return 0; 
}

/**
 * Recupera todas las respuestas para una ronda de juego específica.
 * Utilizado por el anfitrión para revisar las respuestas de los jugadores.
 * @param {number} roundIndex El número de ronda para recuperar las respuestas.
 * @returns {Array<object>} Un array de objetos de respuesta.
 */
function getQuestionResponses(roundIndex) {
  const responsesSheet = getOrCreateSheet(RESPONSES_SHEET_NAME, ['Timestamp', 'Jugador', 'ID_Pregunta', 'Respuesta', 'EsCorrecta', 'PuntuacionGanada', 'Posicion']);
  const questionsSheet = getOrCreateSheet(QUESTIONS_SHEET_NAME, ['ID', 'Ronda', 'Pregunta', 'OpcionA', 'OpcionB', 'OpcionC', 'OpcionD', 'RespuestaCorrecta', 'Posicion']);

  const allResponses = responsesSheet.getDataRange().getValues();
  const allQuestions = questionsSheet.getDataRange().getValues();

  if (allResponses.length <= 1) return []; // Solo encabezado o sin datos

  const currentRoundResponses = [];
  allResponses.slice(1).forEach(responseRow => {
    const questionIdFromResponse = responseRow[2]; // ID_Pregunta en la hoja de Respuestas
    
    // Encontrar la pregunta en la hoja de Preguntas para obtener su número de ronda
    const questionInfo = allQuestions.slice(1).find(qRow => qRow[0] === questionIdFromResponse); // qRow[0] es el ID de la Pregunta
    
    if (questionInfo && Number(questionInfo[1]) === roundIndex) { // qRow[1] es la Ronda en la hoja de Preguntas
      currentRoundResponses.push({
        player: responseRow[1],
        answer: responseRow[3],
        isCorrect: responseRow[4],
        score: responseRow[5],
        position: responseRow[6]
      });
    }
  });
  return currentRoundResponses;
}

/**
 * Recupera las puntuaciones finales de todos los jugadores.
 * Es esencialmente lo mismo que getPlayers() pero semánticamente distinto para mayor claridad.
 * @returns {Array<object>} Un array de objetos de jugador con puntuaciones finales.
 */
function getFinalScores() {
  return getPlayers();
}

/**
 * Registra los resultados finales del juego y de cada jugador en la hoja de historial.
 * Esta función es llamada cuando el anfitrión finaliza el juego o lo resetea.
 * @param {string} gameCompletionStatus El estado en que terminó el juego ('Finalizado' o 'Reseteado').
 * @returns {string} Un mensaje de confirmación.
 */
function recordGameHistory(gameCompletionStatus) {
  const historySheet = getOrCreateSheet(HISTORY_SHEET_NAME, ['Timestamp', 'NombreJugador', 'Posicion', 'PuntuacionFinal', 'RondasCompletadas', 'EstadoJuego', 'GameID']);
  const playersSheet = getOrCreateSheet(PLAYERS_SHEET_NAME, ['NombreJugador', 'Puntuacion', 'Posicion', 'RondaActual']);

  const timestamp = new Date();
  const gameId = `Juego_${timestamp.getTime()}`; 

  const playersData = playersSheet.getDataRange().getValues();
  
  if (playersData.length <= 1) {
    Logger.log('No hay jugadores registrados para guardar en el historial.');
    return 'No hay jugadores para guardar en el historial.';
  }

  for (let i = 1; i < playersData.length; i++) {
    const row = playersData[i];
    const playerName = row[0];
    const finalScore = row[1]; // Puntuacion está en la columna B (índice 1)
    const playerPosition = row[2]; // Posicion está en la columna C (índice 2)
    const roundsCompleted = row[3] || 0; // RondaActual está en la columna D (índice 3)

    historySheet.appendRow([
      timestamp,
      playerName,
      playerPosition,
      finalScore,
      roundsCompleted,
      gameCompletionStatus,
      gameId 
    ]);
  }
  Logger.log(`Historial del juego (${gameCompletionStatus}) guardado con ID: ${gameId}`);
  return `Historial del juego ${gameId} guardado con éxito como "${gameCompletionStatus}".`;
}

/**
 * Reinicia el juego a su estado inicial, borrando puntuaciones de jugadores y respuestas.
 * También registra el historial del juego antes de reiniciar.
 * @returns {string} Un mensaje de confirmación.
 */
function resetGame() {
  const configSheet = getOrCreateSheet(CONFIG_SHEET_NAME);
  const responsesSheet = getOrCreateSheet(RESPONSES_SHEET_NAME);
  const playersSheet = getOrCreateSheet(PLAYERS_SHEET_NAME);

  // Registrar el historial del juego antes de reiniciar
  recordGameHistory('Reseteado'); 

  // Reiniciar el estado del juego en la hoja de Config
  configSheet.getRange('B1').setValue('WAITING');
  configSheet.getRange('B2').setValue(0); // Reiniciar ronda actual

  // Borrar todas las respuestas de la hoja de Respuestas (mantener la fila de encabezado)
  if (responsesSheet.getLastRow() > 1) {
    responsesSheet.deleteRows(2, responsesSheet.getLastRow() - 1);
  }
  
  // Reiniciar las puntuaciones de los jugadores y las rondas actuales en la hoja de Jugadores
  const playersData = playersSheet.getDataRange().getValues();
  if (playersSheet.getLastRow() > 1) {
      for (let i = 1; i < playersData.length; i++) {
          playersSheet.getRange(i + 1, 2).setValue(0); // Columna B (puntuación)
          playersSheet.getRange(i + 1, 4).setValue(0); // Columna D (ronda actual)
      }
  }
  return 'Juego reseteado (solo datos de juego, el servidor sigue en su estado actual).';
}

/**
 * Reinicia completamente el estado del juego, incluyendo apagar el servidor,
 * borrar respuestas y eliminar a todos los jugadores del juego.
 * Esto es para empezar completamente de cero.
 * @returns {string} Un mensaje de confirmación.
 */
function resetServerAndPlayers() {
  const configSheet = getOrCreateSheet(CONFIG_SHEET_NAME);
  const responsesSheet = getOrCreateSheet(RESPONSES_SHEET_NAME);
  const playersSheet = getOrCreateSheet(PLAYERS_SHEET_NAME);

  // Opcional: Registrar el estado actual antes de borrarlo todo
  recordGameHistory('Borrado Completo'); 

  // 2. Apagar el servidor y reiniciar el estado del juego
  configSheet.getRange('B3').setValue(false); // Servidor activo a FALSO
  configSheet.getRange('B1').setValue('WAITING'); // Estado del juego a WAITING
  configSheet.getRange('B2').setValue(0); // Ronda actual a 0

  // 3. Borrar todas las respuestas (excepto el encabezado)
  if (responsesSheet.getLastRow() > 1) {
    responsesSheet.deleteRows(2, responsesSheet.getLastRow() - 1);
  }

  // 4. Borrar todos los jugadores (excepto el encabezado)
  if (playersSheet.getLastRow() > 1) {
    playersSheet.deleteRows(2, playersSheet.getLastRow() - 1);
  }

  return 'Servidor reiniciado, estado del juego reseteado y todos los jugadores borrados. ¡Listo para una nueva partida!';
}


/**
 * Consolida todos los datos necesarios para el panel del anfitrión en una única llamada al servidor.
 * Esto mejora el rendimiento al reducir el número de viajes de ida y vuelta.
 * @returns {object} Un objeto que contiene todos los datos del panel del anfitrión.
 */
function getHostDashboardData() {
  const configSheet = getOrCreateSheet(CONFIG_SHEET_NAME);
  const playersSheet = getOrCreateSheet(PLAYERS_SHEET_NAME);
  const responsesSheet = getOrCreateSheet(RESPONSES_SHEET_NAME);
  const questionsSheet = getOrCreateSheet(QUESTIONS_SHEET_NAME);

  const gameStatus = configSheet.getRange('B1').getValue();
  const currentQuestionIndex = Number(configSheet.getRange('B2').getValue()) || 0; // Esta es la ronda actual
  const serverActive = configSheet.getRange('B3').getValue();

  // Obtener datos de jugadores
  const playersData = playersSheet.getDataRange().getValues();
  const players = playersData.length <= 1 ? [] : playersData.slice(1).map(row => ({ name: row[0], score: row[1], position: row[2], currentRound: row[3] || 0 }));
  
  // Obtener todas las respuestas para la ronda global actual (para revisión del anfitrión)
  // Necesitamos hacer coincidir las respuestas por el número de ronda de la pregunta
  const allResponses = responsesSheet.getDataRange().getValues();
  const allQuestions = questionsSheet.getDataRange().getValues();

  const currentRoundResponses = [];
  if (allResponses.length > 1) { // Si hay respuestas más allá del encabezado
    allResponses.slice(1).forEach(responseRow => {
      const questionIdFromResponse = responseRow[2]; // Este es el ID_Pregunta en Respuestas
      
      // Encontrar la pregunta en la hoja de Preguntas para obtener su número de ronda
      const questionInfo = allQuestions.slice(1).find(qRow => qRow[0] === questionIdFromResponse);
      
      if (questionInfo && Number(questionInfo[1]) === currentQuestionIndex) { // qRow[1] es la Ronda en Preguntas
        currentRoundResponses.push({
          player: responseRow[1],
          answer: responseRow[3],
          isCorrect: responseRow[4],
          score: responseRow[5],
          position: responseRow[6]
        });
      }
    });
  }

  return {
    gameStatus: gameStatus,
    currentQuestionIndex: currentQuestionIndex,
    serverActive: serverActive,
    players: players,
    currentRoundResponses: currentRoundResponses
  };
}

/**
 * Recupera todas las respuestas registradas para la sesión de juego actual de la hoja de Respuestas.
 * @returns {Array<object>} Un array de todos los objetos de respuesta.
 */
function getAllGameResponses() {
  const responsesSheet = getOrCreateSheet(RESPONSES_SHEET_NAME, ['Timestamp', 'Jugador', 'ID_Pregunta', 'Respuesta', 'EsCorrecta', 'PuntuacionGanada', 'Posicion']);
  const data = responsesSheet.getDataRange().getValues();
  
  if (data.length <= 1) return []; // Solo fila de encabezado o sin datos
  
  // Mapea las filas a objetos para facilitar el manejo en el cliente
  return data.slice(1).map(row => ({
    timestamp: row[0],
    player: row[1],
    questionNumber: row[2],
    answer: row[3],
    isCorrect: row[4],
    score: row[5],
    position: row[6]
  }));
}
