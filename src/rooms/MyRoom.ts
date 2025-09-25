import { Room, Client } from "@colyseus/core";
import { MyRoomState, Player } from "./schema/MyRoomState";

export class MyRoom extends Room<MyRoomState> {
  maxClients = 2;

  private betTimer?: NodeJS.Timeout;
  private betTimerInterval?: NodeJS.Timeout;
  private drManhattanTimer?: NodeJS.Timeout;
  private readonly CHOICE_TIME = 7000; // ms (opcional)
  private choiceTimer?: NodeJS.Timeout;
  private bestOp(current: number, diff: number): "+" | "-" {
    const addR = current + diff;
    const subR = current - diff;
    return Math.abs(addR - this.TARGET_SCORE) <=
      Math.abs(subR - this.TARGET_SCORE)
      ? "+"
      : "-";
  }

  // Constantes
  private readonly TARGET_SCORE = 34;
  private readonly DR_MANHATTAN_ID = 67;
  private readonly JOKER_ID = 0; // 👈 Joker = 0, igual que en el cliente
  private readonly BET_TIME = 15; // seg
  private readonly DR_MANHATTAN_DURATION = 5;
  private debugForceManhattanOnce = false; // ponlo en false cuando termines de probar
  private debugForceManhattanPlayer: 1 | 2 = 2; // a quién se la forzas (1 o 2)
  private debugForceManhattanSlot = 0; // índice 0..9 en su mano

  private forceCardInNextDeal(cardId: number, player: 1 | 2, slot: number) {
    const startPos = this.state.game.deckPos;
    const target = player === 1 ? startPos + slot : startPos + 10 + slot;

    // buscar la carta en el mazo (desde el principio; sirve igual)
    let idx = -1;
    for (let i = 0; i < this.state.game.deck.length; i++) {
      if (this.state.game.deck[i] === cardId) {
        idx = i;
        break;
      }
    }
    if (idx === -1) return false; // no está en el mazo (raro)

    // swap: llevamos la carta al slot objetivo
    const tmp = this.state.game.deck[target];
    this.state.game.deck[target] = this.state.game.deck[idx];
    this.state.game.deck[idx] = tmp;
    return true;
  }

  // dentro de MyRoom
  private triggerDrManhattan(ownerId: 1 | 2) {
    const targetId = ownerId === 1 ? 2 : 1;

    const ownerClient = this.clients.find(
      (c) => this.state.players.get(c.sessionId)?.playerId === ownerId
    );
    const targetClient = this.clients.find(
      (c) => this.state.players.get(c.sessionId)?.playerId === targetId
    );

    const opp = this.getPlayer(targetId);
    if (!ownerClient || !opp) return;

    ownerClient.send("dr_manhattan_activated", {
      viewer: ownerId,
      targetPlayer: targetId,
      opponentHand: Array.from(opp.hand),
      oppUsed: Array.from(opp.usedCards),
      oppBlocked: Array.from(opp.blockedCards),
      duration: this.DR_MANHATTAN_DURATION, // ej. 5
    });

    if (targetClient) {
      targetClient.send("dr_manhattan_notice", {
        duration: this.DR_MANHATTAN_DURATION,
      });
    }
  }

  private startChoicePhase(winner: number, diff: number) {
    this.state.game.phase = "battle_choice";
    this.broadcast("battle_choice", {
      winner,
      diff,
      message: `Player ${winner}: Choose to add (+) or subtract (-) ${diff} points`,
    });

    // Timeout opcional: auto-elige la mejor opción si no hay respuesta
    if (this.choiceTimer) clearTimeout(this.choiceTimer);
    this.choiceTimer = setTimeout(() => {
      const p = this.getPlayer(winner);
      if (!p || this.state.game.phase !== "battle_choice") return;

      const op = this.bestOp(p.score, diff);
      p.score = op === "+" ? p.score + diff : p.score - diff;

      this.broadcast("score_updated", {
        playerId: p.playerId,
        newScore: p.score,
        operation: op,
        diff,
        enforced: true, // para HUD si quieres indicar que se aplicó por timeout
      });

      // Continuar flujo
      if (this.state.game.afterStarter) this.finishStarterBattle();
      else this.finishBattle();
    }, this.CHOICE_TIME);
  }

  private clearChoiceTimer() {
    if (this.choiceTimer) {
      clearTimeout(this.choiceTimer);
      this.choiceTimer = undefined;
    }
  }

  // -------- Ciclo de vida --------
  onCreate(options: any) {
    console.log("🎮 Heroes Cards room created!");

    // Estado inicial
    // Usa UNA de estas dos líneas según tu versión de Colyseus:
    // this.setState(new MyRoomState());
    this.state = new MyRoomState();

    this.state.game.targetScore = this.TARGET_SCORE;
    this.setupMessageHandlers();
  }

  onJoin(client: Client, options: any) {
    console.log(`🔗 Player ${client.sessionId} joined!`);

    const player = new Player();
    player.sessionId = client.sessionId;
    player.connected = true;

    // Asigna 1 o 2 de forma estable
    const used = Array.from(this.state.players.values()).map((p) => p.playerId);
    player.playerId = used.includes(1) ? 2 : 1;

    this.state.players.set(client.sessionId, player);
    this.state.playerCount = this.state.players.size;

    console.log(`👥 Players in room: ${this.state.playerCount}/2`);

    client.send("session_info", {
      sessionId: client.sessionId,
      playerId: player.playerId,
    });

    if (this.state.playerCount === 2) {
      this.startGame();
    }
  }

  onLeave(client: Client) {
    console.log(`👋 Player ${client.sessionId} left!`);
    const p = this.state.players.get(client.sessionId);
    if (p) p.connected = false;

    // opcional: pausar/terminar
    // this.state.gameStatus = "waiting";
  }

  onDispose() {
    console.log(`🗑️ Room ${this.roomId} disposing...`);
    this.clearTimers();
  }

  onError(client: Client, code: number, message?: string) {
    console.error("❌ Room error:", code, message);
  }

  // -------- Handlers de mensajes --------
  private setupMessageHandlers() {
    // Apuestas (formatos viejo y nuevo)
    this.onMessage("bet", (client, m: { amount: number }) => {
      this.handleBet(client, m.amount);
    });

    this.onMessage(
      "bet_submit",
      (client, m: { player: number; amount: number }) => {
        const player = this.state.players.get(client.sessionId);
        if (player && player.playerId === m.player) {
          this.handleBet(client, m.amount);
        }
      }
    );

    this.onMessage("confirm_bet", (client) => {
      this.handleConfirmBet(client);
    });

    this.onMessage("bet_confirm", (client, m: { player: number }) => {
      const player = this.state.players.get(client.sessionId);
      if (player && player.playerId === m.player) {
        this.handleConfirmBet(client);
      }
    });

    // Selección de carta
    this.onMessage(
      "select_card",
      (client, m: { cardIndex: number; isOpponent?: boolean }) => {
        this.handleCardSelection(client, m.cardIndex, m.isOpponent);
      }
    );

    // Elección de operación tras ganar
    this.onMessage("battle_choice", (client, m: { operation: "+" | "-" }) => {
      this.handleBattleChoice(client, m.operation);
    });

    // Listo para siguiente ronda
    this.onMessage("ready_next_round", (client) => {
      this.handleReadyNextRound(client);
    });

    // Reiniciar juego
    this.onMessage("restart_game", () => {
      this.restartGame();
    });
  }

  // -------- Utilidades --------
  private clearTimers() {
    if (this.betTimer) {
      clearTimeout(this.betTimer);
      this.betTimer = undefined;
    }
    if (this.betTimerInterval) {
      clearInterval(this.betTimerInterval);
      this.betTimerInterval = undefined;
    }
    if (this.drManhattanTimer) {
      clearTimeout(this.drManhattanTimer);
      this.drManhattanTimer = undefined;
    }
  }

  private getPlayer(id: number): Player | undefined {
    return Array.from(this.state.players.values()).find(
      (p) => p.playerId === id
    );
  }

  // -------- Flujo del juego --------
  private startGame() {
    console.log("🎯 Starting new game!");
    this.state.gameStatus = "playing";
    this.state.game.round = 1;
    this.initializeDeck();
    this.startNewRound();
  }

  private initializeDeck() {
    // Cartas 0..67
    this.state.game.deck.clear();
    const cards = Array.from({ length: 68 }, (_, i) => i);

    // Shuffle
    for (let i = cards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [cards[i], cards[j]] = [cards[j], cards[i]];
    }
    cards.forEach((c) => this.state.game.deck.push(c));

    // Joker aleatorio (1..68) como valor de poder cuando id==0
    this.state.game.jokerValue = Math.floor(Math.random() * 68) + 1;
    this.state.game.deckPos = 0;

    this.broadcast("joker_value", {
      value: this.state.game.jokerValue,
    });

    console.log(
      `🃏 Deck initialized, Joker value: ${this.state.game.jokerValue}`
    );
  }

  private startNewRound() {
    console.log(`🔄 Starting round ${this.state.game.round}`);

    // Reset round state
    this.resetRoundState();

    // 🔁 Crear y barajar un nuevo mazo en CADA ronda
    const newDeck = Array.from({ length: 68 }, (_, i) => i);

    for (let i = newDeck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [newDeck[i], newDeck[j]] = [newDeck[j], newDeck[i]];
    }

    // ✅ Limpiar el ArraySchema y rellenarlo
    this.state.game.deck.clear();
    newDeck.forEach((card) => this.state.game.deck.push(card));
    this.state.game.deckPos = 0;

    // Repartir cartas
    this.dealHands();

    // Iniciar apuestas
    this.startBettingPhase();
  }

  private resetRoundState() {
    this.state.game.phase = "betting";
    this.state.game.currentTurn = 1;
    this.state.game.selectedSelf = -1;
    this.state.game.selectedOpponent = -1;
    this.state.game.starterP1Idx = -1;
    this.state.game.starterP2Idx = -1;
    this.state.game.battleWinner = 0;
    this.state.game.battleDiff = 0;
    this.state.game.battleOp = "";
    this.state.game.afterStarter = false;
    this.state.game.battleCount = 0; // reiniciar contador de batallas

    this.state.players.forEach((p) => {
      // ✅ score por RONDA
      p.score = 0;

      // apuestas (por ronda)
      p.bet = 0;
      p.betConfirmed = false;
      p.ready = false;

      // mano/flags
      p.hand.clear();
      p.usedCards.clear();
      p.blockedCards.clear();
      for (let i = 0; i < 10; i++) {
        p.usedCards.push(false);
        p.blockedCards.push(false);
      }
    });
  }

  private dealHands() {
    const startPos = this.state.game.deckPos;
    const p1 = this.getPlayer(1);
    const p2 = this.getPlayer(2);

    if (!p1 || !p2) {
      console.warn("❌ No están ambos jugadores al repartir");
      return;
    }

    // 🧹 Limpiar manos previas sin romper el ArraySchema
    p1.hand.length = 0;
    p2.hand.length = 0;

    // 👇 SOLO PARA TEST: fuerza Dr. Manhattan una vez
    if (this.debugForceManhattanOnce) {
      const ok = this.forceCardInNextDeal(
        this.DR_MANHATTAN_ID,
        this.debugForceManhattanPlayer, // 1 o 2
        this.debugForceManhattanSlot // 0..9
      );
      console.log("🔧 Force Manhattan:", ok ? "OK" : "NO ENCONTRADA");
      this.debugForceManhattanOnce = false; // quítalo si quieres forzar siempre
    }

    console.log(`🎴 Dealing hands from position ${startPos}`);

    // Reparte 10 cartas a cada jugador
    for (let i = 0; i < 10; i++) {
      const c1 = this.state.game.deck[startPos + i];
      const c2 = this.state.game.deck[startPos + 10 + i];

      if (c1 !== undefined) p1.hand.push(c1);
      if (c2 !== undefined) p2.hand.push(c2);

      console.log(`🃏 Card ${i}: P1 gets ${c1}, P2 gets ${c2}`);
    }

    this.state.game.deckPos += 20;

    // 👉 Mandar mano PRIVADA a cada cliente
    this.clients.forEach((client) => {
      const pl = this.state.players.get(client.sessionId);
      if (pl) {
        client.send("your_hand", { hand: Array.from(pl.hand) });
      }
    });
  }

  // -------- Apuestas --------
  private startBettingPhase() {
    this.state.game.phase = "betting";
    this.state.game.betTimeLeft = this.BET_TIME;

    const p1 = this.getPlayer(1);
    const p2 = this.getPlayer(2);
    console.log("💰 Betting phase started (server)!");
    console.log(
      "P1:",
      p1 ? p1.credits : "NO P1",
      " | P2:",
      p2 ? p2.credits : "NO P2"
    );

    this.broadcast("betting_started", {
      timeLimit: this.BET_TIME,
      round: this.state.game.round,
      p1Credits: p1?.credits ?? 0,
      p2Credits: p2?.credits ?? 0,
      p1Score: 0,
      p2Score: 0,
    });

    this.betTimer = setTimeout(
      () => this.finalizeBetting(),
      this.BET_TIME * 1000
    );

    this.betTimerInterval = setInterval(() => {
      this.state.game.betTimeLeft--;
      this.broadcast("bet_tick", { seconds: this.state.game.betTimeLeft });
      if (this.state.game.betTimeLeft <= 0) {
        clearInterval(this.betTimerInterval!);
        this.betTimerInterval = undefined;
      }
    }, 1000);
  }

  private handleBet(client: Client, amount: number) {
    if (this.state.game.phase !== "betting") return;
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    const clamped = Math.max(0, Math.min(amount, player.credits));
    player.bet = clamped;
    console.log(`💰 Player ${player.playerId} bet ${clamped}`);

    this.broadcast("bet_update", {
      playerId: player.playerId,
      amount: clamped,
    });
  }

  private handleConfirmBet(client: Client) {
    if (this.state.game.phase !== "betting") return;
    const player = this.state.players.get(client.sessionId);
    if (!player || player.betConfirmed) return;

    player.credits -= player.bet; // retención
    player.betConfirmed = true;

    this.broadcast("bet_confirmed", {
      playerId: player.playerId,
      amount: player.bet,
      newCredits: player.credits,
    });

    const allConfirmed = Array.from(this.state.players.values()).every(
      (p) => p.betConfirmed
    );
    if (allConfirmed) this.finalizeBetting(); // NO resets de bet aquí
  }
  private broadcastBetTotals() {
    const p1 = this.getPlayer(1);
    const p2 = this.getPlayer(2);
    this.broadcast("bet_totals", {
      p1Bet: p1?.bet ?? 0,
      p2Bet: p2?.bet ?? 0,
    });
  }

  private finalizeBetting() {
    // 1) Apaga timers
    if (this.betTimer) {
      clearTimeout(this.betTimer);
      this.betTimer = undefined;
    }
    if (this.betTimerInterval) {
      clearInterval(this.betTimerInterval);
      this.betTimerInterval = undefined;
    }

    // 2) Auto-aplicar apuesta mínima si alguien no confirmó (opcional)
    let autoApplied = false;
    this.state.players.forEach((p) => {
      if (!p.betConfirmed) {
        const defaultBet = Math.min(5, Math.max(0, p.credits)); // ó 0 si no quieres auto-bet
        if (defaultBet > 0) {
          p.bet = defaultBet;
          p.credits -= defaultBet; // retención
          autoApplied = true;
        } else {
          p.bet = 0;
        }
        p.betConfirmed = true;

        // Notificar solo si hubo algo que aplicar
        this.broadcast("bet_auto_applied", {
          playerId: p.playerId,
          amount: p.bet,
          newCredits: p.credits,
        });
      }
    });

    // 3) (Opcional) Publica totales de apuestas actuales
    this.broadcastBetTotals();

    // 4) Cierra fase de apuestas (NO resetees apuestas aquí)
    const p1 = this.getPlayer(1);
    const p2 = this.getPlayer(2);
    const b1 = p1?.bet ?? 0;
    const b2 = p2?.bet ?? 0;

    this.broadcast("betting_finished", {
      p1Bet: b1,
      p2Bet: b2,
      total: b1 + b2, // solo informativo para UI
      autoApplied,
    });

    // 5) Continúa con la fase de starters
    this.startStarterPhase();
  }

  // -------- Starter y combates --------
  private startStarterPhase() {
    this.state.game.phase = "starter_p1";
    const players = Array.from(this.state.players.values());
    const p1 = players.find((p) => p.playerId === 1);
    const p2 = players.find((p) => p.playerId === 2);

    this.broadcast("starter_phase", {
      currentPlayer: 1,
      message: "Player 1: Select a card to determine who starts",
      p1Credits: p1?.credits || 100,
      p2Credits: p2?.credits || 100,
    });
  }

  private handleCardSelection(
    client: Client,
    cardIndex: number,
    _isOpponent = false
  ) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    const phase = this.state.game.phase;

    if (phase === "starter_p1") {
      if (player.playerId !== 1 || this.state.game.starterP1Idx !== -1) return;
      this.state.game.starterP1Idx = cardIndex;
      player.blockedCards[cardIndex] = true;
      this.state.game.phase = "starter_p2";

      this.broadcast("card_revealed", {
        playerId: 1,
        cardIndex,
        cardId: player.hand[cardIndex],
      });
      this.broadcast("starter_phase", {
        currentPlayer: 2,
        message: "Player 2: Select a card to determine who starts",
      });
    } else if (phase === "starter_p2") {
      if (player.playerId !== 2 || this.state.game.starterP2Idx !== -1) return;
      this.state.game.starterP2Idx = cardIndex;
      player.blockedCards[cardIndex] = true;

      this.broadcast("card_revealed", {
        playerId: 2,
        cardIndex,
        cardId: player.hand[cardIndex],
      });
      this.resolveStarterBattle();
    } else if (phase === "choose_self") {
      if (player.playerId !== this.state.game.currentTurn) return;
      if (player.usedCards[cardIndex] || player.blockedCards[cardIndex]) return;

      this.state.game.selectedSelf = cardIndex;
      this.state.game.phase = "choose_opponent";

      this.broadcast("card_revealed", {
        playerId: player.playerId,
        cardIndex,
        cardId: player.hand[cardIndex],
      });
      this.broadcast("choose_opponent", {
        message: "Choose opponent's card to battle",
      });
    } else if (phase === "choose_opponent") {
      // El jugador actual elige la carta del oponente para batallar
      if (player.playerId !== this.state.game.currentTurn) return;

      // Obtener el oponente
      const opponentId = this.state.game.currentTurn === 1 ? 2 : 1;
      const opponent = this.getPlayer(opponentId);
      if (!opponent) return;

      // Verificar que la carta del oponente no esté usada o bloqueada
      if (opponent.usedCards[cardIndex] || opponent.blockedCards[cardIndex])
        return;

      this.state.game.selectedOpponent = cardIndex;
      this.broadcast("card_revealed", {
        playerId: opponentId,
        cardIndex,
        cardId: opponent.hand[cardIndex],
      });
      this.resolveBattle();
    }
  }

  private resolveStarterBattle() {
    const p1 = this.getPlayer(1);
    const p2 = this.getPlayer(2);
    if (!p1 || !p2) {
      console.warn("❌ resolveStarterBattle: faltan jugadores");
      return;
    }

    const i1 = this.state.game.starterP1Idx;
    const i2 = this.state.game.starterP2Idx;
    if (i1 < 0 || i2 < 0) {
      console.warn("❌ resolveStarterBattle: índices de starter no válidos");
      return;
    }

    const p1CardId = p1.hand[i1];
    const p2CardId = p2.hand[i2];

    // ✅ AHORA (gatilla para el dueño que la jugó)
    if (p1CardId === this.DR_MANHATTAN_ID) this.triggerDrManhattan(1);
    if (p2CardId === this.DR_MANHATTAN_ID) this.triggerDrManhattan(2);

    const p1Power = this.getCardPower(p1CardId);
    const p2Power = this.getCardPower(p2CardId);

    const diff = Math.abs(p1Power - p2Power);
    const winner = p1Power === p2Power ? 0 : p1Power > p2Power ? 1 : 2;

    // Actualizar estado de la batalla
    this.state.game.battleCount++; // incrementar contador de batallas
    this.state.game.battleWinner = winner;
    this.state.game.battleDiff = diff;
    this.state.game.afterStarter = true;
    this.state.game.currentTurn = winner === 0 ? 1 : winner; // si empatan, arranca P1

    console.log(
      `⚔️ Starter battle: P1(${p1CardId}=${p1Power}) vs P2(${p2CardId}=${p2Power}), winner: ${winner}`
    );

    // Notificar resultado del VS inicial
    this.broadcast("starter_battle_result", {
      p1Card: p1CardId,
      p2Card: p2CardId,
      p1Power,
      p2Power,
      winner,
      diff,
      nextTurn: this.state.game.currentTurn,
    });

    // Habilidades especiales (Dr. Manhattan, etc.)

    // Si hay ganador, pedir elección +/-
    if (winner > 0 && diff > 0) {
      this.startChoicePhase(winner, diff);
    } else {
      // Empate (o diff=0): pasar directamente a la fase siguiente
      this.finishStarterBattle();
    }
  }
  // ID que ya usas para Dr. Manhattan

  // Mueve una carta específica a un índice de la mano del jugador (haciendo swap si ya estaba en otro lado)
  private forceCardInHand(cardId: number, playerId: 1 | 2, handIndex = 0) {
    const p1 = this.getPlayer(1);
    const p2 = this.getPlayer(2);
    const p = this.getPlayer(playerId);
    if (!p1 || !p2 || !p) return;

    // ¿Ya está en la posición objetivo?
    if (p.hand[handIndex] === cardId) return;

    // 1) Buscar dentro de ambas manos y swappear si la encontramos
    for (let i = 0; i < 10; i++) {
      if (p1.hand[i] === cardId) {
        const tmp = p.hand[handIndex];
        p1.hand[i] = tmp;
        p.hand[handIndex] = cardId;
        return;
      }
      if (p2.hand[i] === cardId) {
        const tmp = p.hand[handIndex];
        p2.hand[i] = tmp;
        p.hand[handIndex] = cardId;
        return;
      }
    }

    // 2) Si no estaba en manos, intentar buscarla en el mazo restante
    const start = this.state.game.deckPos; // después de repartir, apunta al siguiente bloque
    const idx = this.state.game.deck.indexOf(cardId, start);
    if (idx >= 0) {
      // Cambiar por la carta que tenía el jugador en ese índice
      const tmp = p.hand[handIndex];
      this.state.game.deck[idx] = tmp;
      p.hand[handIndex] = cardId;
    }
  }

  private resolveBattle() {
    const players = Array.from(this.state.players.values());
    const currentPlayer = players.find(
      (p) => p.playerId === this.state.game.currentTurn
    )!;
    const opponentPlayer = players.find(
      (p) => p.playerId !== this.state.game.currentTurn
    )!;

    const selfCardId = currentPlayer.hand[this.state.game.selectedSelf];
    const oppCardId = opponentPlayer.hand[this.state.game.selectedOpponent];

    if (selfCardId === this.DR_MANHATTAN_ID) {
      this.triggerDrManhattan(this.state.game.currentTurn as 1 | 2); // el que jugó su carta
    }

    const selfPower = this.getCardPower(selfCardId);
    const oppPower = this.getCardPower(oppCardId);

    const diff = Math.abs(selfPower - oppPower);
    const win = selfPower > oppPower;
    const tie = selfPower === oppPower;

    // Incrementar contador de batallas
    this.state.game.battleCount++;

    currentPlayer.usedCards[this.state.game.selectedSelf] = true;
    opponentPlayer.usedCards[this.state.game.selectedOpponent] = true;

    this.state.game.battleWinner = win
      ? this.state.game.currentTurn
      : tie
      ? 0
      : this.state.game.currentTurn === 1
      ? 2
      : 1;
    this.state.game.battleDiff = diff;

    this.broadcast("battle_result", {
      currentPlayer: this.state.game.currentTurn,
      selfCard: selfCardId,
      oppCard: oppCardId,
      selfPower,
      oppPower,
      winner: this.state.game.battleWinner,
      diff,
      win,
      tie,
    });

    if (win) {
      this.state.game.phase = "battle_choice";
      this.broadcast("battle_choice", {
        winner: this.state.game.currentTurn,
        diff,
        message: `Player ${this.state.game.currentTurn}: Choose to add (+) or subtract (-) ${diff} points`,
      });
    } else {
      this.finishBattle();
    }
  }

  private handleBattleChoice(client: Client, operation: "+" | "-") {
    if (this.state.game.phase !== "battle_choice") return;

    const player = this.state.players.get(client.sessionId);
    if (!player || player.playerId !== this.state.game.battleWinner) return;

    const diff = this.state.game.battleDiff;
    this.state.game.battleOp = operation;

    if (operation === "+") {
      player.score = this.bestNewScore(player.score, diff, "+");
    } else {
      player.score = this.bestNewScore(player.score, diff, "-");
    }

    this.broadcast("score_updated", {
      playerId: player.playerId,
      newScore: player.score,
      operation,
      diff,
    });

    // ✅ NO terminar partida aunque llegue a 34 exacto.
    // Continúa el flujo normal:
    if (this.state.game.afterStarter) {
      this.finishStarterBattle();
    } else {
      this.finishBattle();
    }
  }

  private finishStarterBattle() {
    this.state.game.afterStarter = false;
    this.state.game.selectedSelf = -1;
    this.state.game.selectedOpponent = -1;
    this.state.game.phase = "choose_self";

    this.broadcast("starter_finished", {
      nextTurn: this.state.game.currentTurn,
      message: `Player ${this.state.game.currentTurn}: Choose your card`,
    });

    // Enviar inmediatamente la fase de elección
    setTimeout(() => {
      this.broadcast("choose_self", {
        currentPlayer: this.state.game.currentTurn,
        message: `Player ${this.state.game.currentTurn}: Choose your card`,
      });
    }, 1500);
  }

  private finishBattle() {
    // NUEVA LÓGICA: Alternancia automática después de la primera batalla
    // battleCount 1 = primera batalla después del starter: el ganador continúa
    // battleCount > 1 = batallas posteriores: siempre alternar turnos

    if (this.state.game.battleCount === 1) {
      // Primera batalla después del starter: el ganador mantiene el turno
      if (
        this.state.game.battleWinner !== this.state.game.currentTurn &&
        this.state.game.battleWinner !== 0
      ) {
        console.log(
          `First battle: Player ${this.state.game.currentTurn} lost, switching turns`
        );
        this.state.game.currentTurn = this.state.game.currentTurn === 1 ? 2 : 1;
      } else {
        console.log(
          `First battle: Player ${this.state.game.currentTurn} continues (won or tied)`
        );
      }
    } else {
      // Batallas posteriores: siempre alternar turnos sin importar el resultado
      const previousTurn = this.state.game.currentTurn;
      this.state.game.currentTurn = this.state.game.currentTurn === 1 ? 2 : 1;
      console.log(
        `Battle ${this.state.game.battleCount}: Auto-switching from Player ${previousTurn} to Player ${this.state.game.currentTurn}`
      );
    }

    this.state.game.selectedSelf = -1;
    this.state.game.selectedOpponent = -1;
    this.state.game.phase = "choose_self";

    const players = Array.from(this.state.players.values());
    const p1 = players.find((p) => p.playerId === 1)!;
    const p2 = players.find((p) => p.playerId === 2)!;

    // Notificar cambio de turno o continuación
    const isContinued =
      this.state.game.battleCount === 1 &&
      (this.state.game.battleWinner === this.state.game.currentTurn ||
        this.state.game.battleWinner === 0);

    const message =
      this.state.game.battleCount === 1
        ? isContinued
          ? `Player ${this.state.game.currentTurn}: You won! Continue choosing your card`
          : `Player ${this.state.game.currentTurn}: Your turn to choose a card`
        : `Player ${this.state.game.currentTurn}: Your turn to choose a card (auto-alternating)`;

    this.broadcast("turn_changed", {
      currentPlayer: this.state.game.currentTurn,
      message,
      continued: isContinued,
      p1Credits: p1.credits,
      p2Credits: p2.credits,
      battleCount: this.state.game.battleCount, // incluir contador de batallas
    });

    const p1Used =
      p1.usedCards.filter((u) => u).length +
      (this.state.game.starterP1Idx !== -1 ? 1 : 0);
    const p2Used =
      p2.usedCards.filter((u) => u).length +
      (this.state.game.starterP2Idx !== -1 ? 1 : 0);

    if (p1Used >= 10 && p2Used >= 10) {
      this.finishRound();
    } else {
      this.broadcast("next_turn", {
        currentTurn: this.state.game.currentTurn,
        message,
        continued: isContinued,
        p1Credits: p1.credits,
        p2Credits: p2.credits,
        battleCount: this.state.game.battleCount, // incluir contador de batallas
      });
    }
  }

  private finishRound() {
    this.state.game.phase = "round_finished";

    const p1 = this.getPlayer(1)!;
    const p2 = this.getPlayer(2)!;

    // Ganador de la RONDA por cercanía a 34 (puntaje acumulado)
    const d1 = Math.abs(p1.score - this.TARGET_SCORE);
    const d2 = Math.abs(p2.score - this.TARGET_SCORE);

    let winner = 0;
    if (d1 < d2) winner = 1;
    else if (d2 < d1) winner = 2;

    // 💸 Pago de apuestas de la ronda
    if (winner === 1) {
      p1.credits += 2 * p1.bet;
    } else if (winner === 2) {
      p2.credits += 2 * p2.bet;
    } else {
      // Empate → devolver apuestas
      p1.credits += p1.bet;
      p2.credits += p2.bet;
    }

    // Notificar a clientes fin de ronda
    this.broadcast("round_finished", {
      winner,
      p1Score: p1.score,
      p2Score: p2.score,
      p1Credits: p1.credits,
      p2Credits: p2.credits,
      round: this.state.game.round,
    });

    // ✅ Condiciones de FIN DE PARTIDA por créditos
    if (p1.credits <= 0 || p2.credits <= 0) {
      this.endGame("busted");
      return;
    }
    if (p1.credits >= 1000 || p2.credits >= 1000) {
      this.endGame("real_winner");
      return;
    }

    // ✅ Condición por número de rondas
    if (this.state.game.round >= 10) {
      // Se acabaron las rondas → determinar ganador por cercanía a 34
      const d1Final = Math.abs(p1.score - this.TARGET_SCORE);
      const d2Final = Math.abs(p2.score - this.TARGET_SCORE);

      let finalWinner = 0;
      if (d1Final < d2Final) finalWinner = 1;
      else if (d2Final < d1Final) finalWinner = 2;

      this.endGame("round_limit", finalWinner);
      return;
    }

    // ✅ Si no terminó la partida → iniciar la siguiente ronda
    setTimeout(() => {
      this.state.game.round++;

      // 🎲 Nuevo valor para Joker en cada ronda
      this.state.game.jokerValue = Math.floor(Math.random() * 68) + 1;

      // Avisar a todos los clientes
      this.broadcast("joker_value", {
        value: this.state.game.jokerValue,
        round: this.state.game.round,
      });

      this.startNewRound(); // Reparte nuevo mazo y reinicia bets/manos/used
    }, 3000);
  }

  private endGame(reason: string, forcedWinner?: number) {
    this.state.gameStatus = "finished";
    this.state.game.phase = "game_over";

    const p1 = this.getPlayer(1)!;
    const p2 = this.getPlayer(2)!;

    let winner = 0;

    if (reason === "busted") {
      winner = p1.credits > p2.credits ? 1 : 2;
    } else if (reason === "real_winner") {
      winner = p1.credits >= 1000 ? 1 : 2;
    } else if (reason === "round_limit") {
      if (forcedWinner !== undefined) {
        winner = forcedWinner; // ya lo calculaste en finishRound()
      } else {
        // fallback: calcular aquí por cercanía a 34
        const d1 = Math.abs(p1.score - this.TARGET_SCORE);
        const d2 = Math.abs(p2.score - this.TARGET_SCORE);
        winner = d1 < d2 ? 1 : d2 < d1 ? 2 : 0; // empate si están igual de cerca
      }
    }

    this.broadcast("game_over", {
      winner,
      reason,
      p1Score: p1.score,
      p2Score: p2.score,
      p1Credits: p1.credits,
      p2Credits: p2.credits,
    });

    console.log(
      `🏁 Game ended - Winner: ${
        winner === 0 ? "Tie" : "P" + winner
      } — Reason: ${reason}`
    );
  }

  private handleReadyNextRound(client: Client) {
    const p = this.state.players.get(client.sessionId);
    if (!p) return;
    p.ready = true;
    const all = Array.from(this.state.players.values()).every((pp) => pp.ready);
    if (all) {
      this.state.game.round++;
      this.startNewRound();
    }
  }

  private restartGame() {
    console.log("🔄 Restarting game...");
    this.clearTimers();

    this.state.players.forEach((p) => {
      p.score = 0;
      p.credits = 100;
      p.ready = false;
      p.bet = 0;
      p.betConfirmed = false;
      p.hand.clear();
      p.usedCards.clear();
      p.blockedCards.clear();
    });

    this.state.gameStatus = "playing";
    this.state.game.round = 1;
    this.initializeDeck();
    this.startNewRound();
  }

  private getCardPower(cardId: number): number {
    // Joker = 0 -> usa jokerValue
    if (cardId === this.JOKER_ID) return this.state.game.jokerValue;
    return cardId; // el resto valen su id (cliente usa así)
  }

  private bestNewScore(
    current: number,
    diff: number,
    preferred?: "+" | "-"
  ): number {
    const target = this.TARGET_SCORE;
    const addR = current + diff;
    const subR = current - diff;
    if (preferred === "+") return addR;
    if (preferred === "-") return subR;
    return Math.abs(addR - target) <= Math.abs(subR - target) ? addR : subR;
  }
}
