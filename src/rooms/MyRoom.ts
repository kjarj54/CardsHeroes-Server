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

    console.log(
      `🃏 Deck initialized, Joker value: ${this.state.game.jokerValue}`
    );
  }

  private startNewRound() {
    console.log(`🔄 Starting round ${this.state.game.round}`);

    // ¿Alcanza el mazo?
    if (this.state.game.deckPos + 20 > this.state.game.deck.length) {
      this.endGame("deck_empty");
      return;
    }

    this.resetRoundState();
    this.dealHands(); // 👉 reparte y manda "your_hand" a cada cliente
    this.startBettingPhase(); // 👉 arranca apuestas
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
    this.state.game.drManhattanActive = false;
    this.state.game.drManhattanTimeLeft = 0;
    this.state.game.pot = 0;

    this.state.players.forEach((p) => {
      p.bet = 0;
      p.betConfirmed = false;
      p.ready = false;
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

    console.log(`🎴 Dealing hands from position ${startPos}`);
    for (let i = 0; i < 10; i++) {
      const c1 = this.state.game.deck[startPos + i];
      const c2 = this.state.game.deck[startPos + 10 + i];
      p1.hand.push(c1);
      p2.hand.push(c2);
      console.log(`🃏 Card ${i}: P1 gets ${c1}, P2 gets ${c2}`);
    }
    this.state.game.deckPos += 20;

    // Enviar mano PRIVADA a cada cliente
    this.clients.forEach((client) => {
      const pl = this.state.players.get(client.sessionId);
      if (pl) client.send("your_hand", { hand: Array.from(pl.hand) });
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

    player.credits -= player.bet;
    player.betConfirmed = true;
    this.state.game.pot += player.bet;

    console.log(`✅ Player ${player.playerId} confirmed bet of ${player.bet}`);

    this.broadcast("bet_confirmed", {
      playerId: player.playerId,
      amount: player.bet,
      newCredits: player.credits, // 👈 tu cliente espera 'newCredits'
    });

    const allConfirmed = Array.from(this.state.players.values()).every(
      (p) => p.betConfirmed
    );
    if (allConfirmed) {
      console.log("🎯 Both players confirmed - finalizing betting immediately");
      this.finalizeBetting();
    }
  }

  private finalizeBetting() {
    if (this.betTimer) {
      clearTimeout(this.betTimer);
      this.betTimer = undefined;
    }
    if (this.betTimerInterval) {
      clearInterval(this.betTimerInterval);
      this.betTimerInterval = undefined;
    }

    // Auto-apuesta por defecto si alguien no confirmó
    let autoApplied = false;
    this.state.players.forEach((player) => {
      if (!player.betConfirmed) {
        const defaultBet = Math.min(5, player.credits);
        player.bet = defaultBet;
        player.credits -= defaultBet;
        player.betConfirmed = true;
        this.state.game.pot += defaultBet;
        autoApplied = true;

        console.log(
          `⏰ Auto-applied bet for Player ${player.playerId}: ${defaultBet}`
        );
        this.broadcast("bet_auto_applied", {
          playerId: player.playerId,
          amount: defaultBet,
          newCredits: player.credits,
        });
      }
    });

    console.log(
      `💼 Betting finished, pot: ${this.state.game.pot}${
        autoApplied ? " (some auto-applied)" : ""
      }`
    );
    this.broadcast("betting_finished", {
      pot: this.state.game.pot,
      autoApplied,
    });

    this.startStarterPhase();
  }

  // -------- Starter y combates --------
  private startStarterPhase() {
    this.state.game.phase = "starter_p1";
    this.broadcast("starter_phase", {
      currentPlayer: 1,
      message: "Player 1: Select a card to determine who starts",
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
      if (player.playerId === this.state.game.currentTurn) return;
      if (player.usedCards[cardIndex] || player.blockedCards[cardIndex]) return;

      this.state.game.selectedOpponent = cardIndex;
      this.broadcast("card_revealed", {
        playerId: player.playerId,
        cardIndex,
        cardId: player.hand[cardIndex],
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

    const p1Power = this.getCardPower(p1CardId);
    const p2Power = this.getCardPower(p2CardId);

    const diff = Math.abs(p1Power - p2Power);
    const winner = p1Power === p2Power ? 0 : p1Power > p2Power ? 1 : 2;

    // Actualizar estado de la batalla
    this.state.game.battleWinner = winner;
    this.state.game.battleDiff = diff;
    this.state.game.afterStarter = true;
    this.state.game.currentTurn = winner === 0 ? 1 : winner; // si empatan, arranca P1

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
    this.handleSpecialAbilities(p1CardId, p2CardId);

    // Si hay ganador, pedir elección +/-
    if (winner > 0 && diff > 0) {
      this.startChoicePhase(winner, diff);
    } else {
      // Empate (o diff=0): pasar directamente a la fase siguiente
      this.finishStarterBattle();
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

    const selfPower = this.getCardPower(selfCardId);
    const oppPower = this.getCardPower(oppCardId);

    const diff = Math.abs(selfPower - oppPower);
    const win = selfPower > oppPower;
    const tie = selfPower === oppPower;

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

    this.handleSpecialAbilities(selfCardId, oppCardId);

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

  private handleSpecialAbilities(card1Id: number, card2Id: number) {
    if (card1Id === this.DR_MANHATTAN_ID || card2Id === this.DR_MANHATTAN_ID) {
      this.state.game.drManhattanActive = true;
      this.state.game.drManhattanTimeLeft = this.DR_MANHATTAN_DURATION;

      this.broadcast("dr_manhattan_activated", {
        duration: this.DR_MANHATTAN_DURATION,
      });

      this.drManhattanTimer = setTimeout(() => {
        this.state.game.drManhattanActive = false;
        this.state.game.drManhattanTimeLeft = 0;
        this.broadcast("dr_manhattan_deactivated");
      }, this.DR_MANHATTAN_DURATION * 1000);
    }
  }

  private handleBattleChoice(client: Client, operation: "+" | "-") {
    if (this.state.game.phase !== "battle_choice") return;

    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    // Solo el ganador puede elegir
    if (player.playerId !== this.state.game.battleWinner) return;

    this.clearChoiceTimer();

    const diff = this.state.game.battleDiff;

    // Si quieres forzar SIEMPRE la mejor opción, usa:
    // const op = this.bestOp(player.score, diff);
    // Si quieres respetar la elección del jugador:
    const op = operation;

    player.score = op === "+" ? player.score + diff : player.score - diff;

    this.broadcast("score_updated", {
      playerId: player.playerId,
      newScore: player.score,
      operation: op,
      diff,
    });

    if (this.state.game.afterStarter) this.finishStarterBattle();
    else this.finishBattle();
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
  }

  private finishBattle() {
    this.state.game.currentTurn = this.state.game.currentTurn === 1 ? 2 : 1;
    this.state.game.selectedSelf = -1;
    this.state.game.selectedOpponent = -1;
    this.state.game.phase = "choose_self";

    const players = Array.from(this.state.players.values());
    const p1 = players.find((p) => p.playerId === 1)!;
    const p2 = players.find((p) => p.playerId === 2)!;

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
        message: `Player ${this.state.game.currentTurn}: Choose your card`,
      });
    }
  }

  private finishRound() {
    this.state.game.phase = "round_finished";

    const players = Array.from(this.state.players.values());
    const p1 = players.find((p) => p.playerId === 1)!;
    const p2 = players.find((p) => p.playerId === 2)!;

    const p1Distance = Math.abs(p1.score - this.TARGET_SCORE);
    const p2Distance = Math.abs(p2.score - this.TARGET_SCORE);

    let roundWinner = 0;
    if (p1Distance < p2Distance) {
      roundWinner = 1;
      p1.credits += this.state.game.pot;
    } else if (p2Distance < p1Distance) {
      roundWinner = 2;
      p2.credits += this.state.game.pot;
    } else {
      const half = Math.floor(this.state.game.pot / 2);
      p1.credits += half;
      p2.credits += this.state.game.pot - half;
    }

    this.broadcast("round_finished", {
      winner: roundWinner,
      p1Score: p1.score,
      p2Score: p2.score,
      p1Credits: p1.credits,
      p2Credits: p2.credits,
      pot: this.state.game.pot,
    });

    if (p1.credits <= 0 || p2.credits <= 0) this.endGame("busted");
    else if (p1.credits >= 1000 || p2.credits >= 1000)
      this.endGame("real_winner");
    else {
      setTimeout(() => {
        this.state.game.round++;
        this.startNewRound();
      }, 3000);
    }
  }

  private endGame(reason: "busted" | "real_winner" | "deck_empty") {
    this.state.gameStatus = "finished";
    this.state.game.phase = "game_over";

    const players = Array.from(this.state.players.values());
    const p1 = players.find((p) => p.playerId === 1)!;
    const p2 = players.find((p) => p.playerId === 2)!;

    let winner = 0;
    if (reason === "busted") {
      winner = p1.credits > p2.credits ? 1 : 2;
    } else if (reason === "real_winner") {
      winner = p1.credits >= 1000 ? 1 : 2;
    } else {
      const p1Dist = Math.abs(p1.score - this.TARGET_SCORE);
      const p2Dist = Math.abs(p2.score - this.TARGET_SCORE);
      winner = p1Dist < p2Dist ? 1 : p2Dist < p1Dist ? 2 : 0;
    }

    this.broadcast("game_over", {
      winner,
      reason,
      p1Score: p1.score,
      p2Score: p2.score,
      p1Credits: p1.credits,
      p2Credits: p2.credits,
    });

    console.log(`🏁 Game ended - Winner: Player ${winner}, Reason: ${reason}`);
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
