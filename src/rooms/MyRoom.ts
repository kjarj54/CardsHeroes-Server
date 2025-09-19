import { Room, Client } from "@colyseus/core";
import { MyRoomState, Player, GameState } from "./schema/MyRoomState";

export class MyRoom extends Room<MyRoomState> {
  maxClients = 2;
  state = new MyRoomState();
  private betTimer?: NodeJS.Timeout;
  private betTimerInterval?: NodeJS.Timeout;
  private drManhattanTimer?: NodeJS.Timeout;

  // Constants
  private readonly TARGET_SCORE = 34;
  private readonly DR_MANHATTAN_ID = 67;
  private readonly JOKER_ID = 68; // Assuming Joker is card 68
  private readonly BET_TIME = 15; // seconds
  private readonly DR_MANHATTAN_DURATION = 5; // seconds

  onCreate(options: any) {
    console.log("🎮 Heroes Cards room created!");
    
    this.state.game.targetScore = this.TARGET_SCORE;
    this.setupMessageHandlers();
  }

  private setupMessageHandlers() {
    // Player betting - support both old and new message formats
    this.onMessage("bet", (client, message: { amount: number }) => {
      this.handleBet(client, message.amount);
    });

    this.onMessage("bet_submit", (client, message: { player: number, amount: number }) => {
      // New format from client - validate player ID matches
      const player = this.state.players.get(client.sessionId);
      if (player && player.playerId === message.player) {
        this.handleBet(client, message.amount);
      }
    });

    this.onMessage("confirm_bet", (client) => {
      this.handleConfirmBet(client);
    });

    this.onMessage("bet_confirm", (client, message: { player: number }) => {
      // New format from client - validate player ID matches
      const player = this.state.players.get(client.sessionId);
      if (player && player.playerId === message.player) {
        this.handleConfirmBet(client);
      }
    });

    // Card selection
    this.onMessage("select_card", (client, message: { cardIndex: number, isOpponent?: boolean }) => {
      this.handleCardSelection(client, message.cardIndex, message.isOpponent);
    });

    // Battle result choice (add/subtract)
    this.onMessage("battle_choice", (client, message: { operation: "+" | "-" }) => {
      this.handleBattleChoice(client, message.operation);
    });

    // Ready for next round
    this.onMessage("ready_next_round", (client) => {
      this.handleReadyNextRound(client);
    });

    // Restart game
    this.onMessage("restart_game", (client) => {
      this.restartGame();
    });
  }

  onJoin(client: Client, options: any) {
    console.log(`🔗 Player ${client.sessionId} joined!`);

    const player = new Player();
    player.sessionId = client.sessionId;
    player.connected = true;
    player.playerId = this.state.playerCount + 1;
    
    this.state.players.set(client.sessionId, player);
    this.state.playerCount++;

    console.log(`👥 Players in room: ${this.state.playerCount}/2`);

    // Send session info to the client immediately
    client.send("session_info", {
      sessionId: client.sessionId,
      playerId: player.playerId
    });

    if (this.state.playerCount === 2) {
      this.startGame();
    }
  }

  onLeave(client: Client, consented: boolean) {
    console.log(`👋 Player ${client.sessionId} left!`);
    
    const player = this.state.players.get(client.sessionId);
    if (player) {
      player.connected = false;
    }

    // Handle disconnection during game
    if (this.state.gameStatus === "playing") {
      console.log("⚠️ Player disconnected during game - pausing...");
      // Game could be paused here or handle reconnection logic
    }
  }

  onDispose() {
    console.log(`🗑️ Room ${this.roomId} disposing...`);
    this.clearTimers();
  }

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

  private startGame() {
    console.log("🎯 Starting new game!");
    
    this.state.gameStatus = "playing";
    this.state.game.round = 1;
    this.initializeDeck();
    this.startNewRound();
  }

  private initializeDeck() {
    // Create deck with cards 0-67 (68 total cards)
    this.state.game.deck.clear();
    const cards = Array.from({ length: 68 }, (_, i) => i);
    
    // Shuffle deck
    for (let i = cards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [cards[i], cards[j]] = [cards[j], cards[i]];
    }
    
    cards.forEach(card => this.state.game.deck.push(card));
    
    // Set random Joker value (1-68)
    this.state.game.jokerValue = Math.floor(Math.random() * 68) + 1;
    this.state.game.deckPos = 0;
    
    console.log(`🃏 Deck initialized, Joker value: ${this.state.game.jokerValue}`);
  }

  private startNewRound() {
    console.log(`🔄 Starting round ${this.state.game.round}`);
    
    // Check if enough cards remain (20 cards needed: 10 per player)
    if (this.state.game.deckPos + 20 > this.state.game.deck.length) {
      this.endGame("deck_empty");
      return;
    }

    // Reset round state
    this.resetRoundState();
    
    // Deal hands
    this.dealHands();
    
    // Start betting phase
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
    this.state.game.drManhattanActive = false;
    this.state.game.drManhattanTimeLeft = 0;
    this.state.game.pot = 0;

    // Reset player round state
    this.state.players.forEach(player => {
      player.bet = 0;
      player.betConfirmed = false;
      player.ready = false;
      player.hand.clear();
      player.usedCards.clear();
      player.blockedCards.clear();
      
      // Initialize arrays
      for (let i = 0; i < 10; i++) {
        player.usedCards.push(false);
        player.blockedCards.push(false);
      }
    });
  }

  private dealHands() {
    const players = Array.from(this.state.players.values());
    const startPos = this.state.game.deckPos;
    
    console.log(`🎴 Dealing hands to ${players.length} players from position ${startPos}`);
    
    // Deal 10 cards to each player
    for (let i = 0; i < 10; i++) {
      const card1 = this.state.game.deck[startPos + i];
      const card2 = this.state.game.deck[startPos + 10 + i];
      
      players[0].hand.push(card1);
      players[1].hand.push(card2);
      
      console.log(`🃏 Card ${i}: P1 gets ${card1}, P2 gets ${card2}`);
    }
    
    this.state.game.deckPos += 20;
    console.log(`🎴 Hands dealt, deck position: ${this.state.game.deckPos}`);
    console.log(`📋 P1 hand length: ${players[0].hand.length}, P2 hand length: ${players[1].hand.length}`);
  }

  private startBettingPhase() {
    this.state.game.phase = "betting";
    this.state.game.betTimeLeft = this.BET_TIME;
    
    this.broadcast("betting_started", {
      timeLimit: this.BET_TIME,
      round: this.state.game.round
    });

    this.betTimer = setTimeout(() => {
      this.finalizeBetting();
    }, this.BET_TIME * 1000);

    // Send timer updates every second
    this.betTimerInterval = setInterval(() => {
      this.state.game.betTimeLeft--;
      
      // Broadcast timer update to all clients
      this.broadcast("bet_tick", {
        seconds: this.state.game.betTimeLeft
      });
      
      if (this.state.game.betTimeLeft <= 0) {
        clearInterval(this.betTimerInterval);
        this.betTimerInterval = undefined;
      }
    }, 1000);
  }

  private handleBet(client: Client, amount: number) {
    if (this.state.game.phase !== "betting") return;
    
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    // Clamp bet amount
    const clampedAmount = Math.max(0, Math.min(amount, player.credits));
    player.bet = clampedAmount;
    
    console.log(`💰 Player ${player.playerId} bet ${clampedAmount}`);
    
    // Broadcast bet update to all players so they can see opponent's bet
    this.broadcast("bet_update", {
      playerId: player.playerId,
      amount: clampedAmount
    });
  }

  private handleConfirmBet(client: Client) {
    if (this.state.game.phase !== "betting") return;
    
    const player = this.state.players.get(client.sessionId);
    if (!player || player.betConfirmed) return;

    // Reserve credits
    player.credits -= player.bet;
    player.betConfirmed = true;
    this.state.game.pot += player.bet;
    
    console.log(`✅ Player ${player.playerId} confirmed bet of ${player.bet}`);
    
    // Broadcast confirmation to all players
    this.broadcast("bet_confirmed", {
      playerId: player.playerId,
      amount: player.bet,
      newCredits: player.credits
    });
    
    // Check if both players confirmed
    const allConfirmed = Array.from(this.state.players.values())
      .every(p => p.betConfirmed);
    
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

    // Auto-confirm any unconfirmed bets with default amount
    let autoApplied = false;
    this.state.players.forEach(player => {
      if (!player.betConfirmed) {
        const defaultBet = Math.min(5, player.credits); // Default bet of 5 or remaining credits
        player.bet = defaultBet;
        player.credits -= defaultBet;
        player.betConfirmed = true;
        this.state.game.pot += defaultBet;
        autoApplied = true;
        
        console.log(`⏰ Auto-applied bet for Player ${player.playerId}: ${defaultBet}`);
        
        // Notify about auto-bet
        this.broadcast("bet_auto_applied", {
          playerId: player.playerId,
          amount: defaultBet,
          newCredits: player.credits
        });
      }
    });

    console.log(`💼 Betting finished, pot: ${this.state.game.pot}${autoApplied ? ' (some auto-applied)' : ''}`);
    
    // Broadcast final betting state
    this.broadcast("betting_finished", {
      pot: this.state.game.pot,
      autoApplied: autoApplied
    });
    
    this.startStarterPhase();
  }

  private startStarterPhase() {
    this.state.game.phase = "starter_p1";
    this.broadcast("starter_phase", { 
      currentPlayer: 1,
      message: "Player 1: Select a card to determine who starts"
    });
  }

  private handleCardSelection(client: Client, cardIndex: number, isOpponent: boolean = false) {
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
        cardId: player.hand[cardIndex]
      });
      
      this.broadcast("starter_phase", {
        currentPlayer: 2,
        message: "Player 2: Select a card to determine who starts"
      });
      
    } else if (phase === "starter_p2") {
      if (player.playerId !== 2 || this.state.game.starterP2Idx !== -1) return;
      
      this.state.game.starterP2Idx = cardIndex;
      player.blockedCards[cardIndex] = true;
      
      this.broadcast("card_revealed", {
        playerId: 2,
        cardIndex,
        cardId: player.hand[cardIndex]
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
        cardId: player.hand[cardIndex]
      });
      
      this.broadcast("choose_opponent", {
        message: "Choose opponent's card to battle"
      });
      
    } else if (phase === "choose_opponent") {
      if (player.playerId === this.state.game.currentTurn) return; // Wrong player
      if (player.usedCards[cardIndex] || player.blockedCards[cardIndex]) return;
      
      this.state.game.selectedOpponent = cardIndex;
      
      this.broadcast("card_revealed", {
        playerId: player.playerId,
        cardIndex,
        cardId: player.hand[cardIndex]
      });
      
      this.resolveBattle();
    }
  }

  private resolveStarterBattle() {
    const players = Array.from(this.state.players.values());
    const p1 = players.find(p => p.playerId === 1)!;
    const p2 = players.find(p => p.playerId === 2)!;
    
    const p1CardId = p1.hand[this.state.game.starterP1Idx];
    const p2CardId = p2.hand[this.state.game.starterP2Idx];
    
    const p1Power = this.getCardPower(p1CardId);
    const p2Power = this.getCardPower(p2CardId);
    
    const diff = Math.abs(p1Power - p2Power);
    let winner = 0;
    
    if (p1Power > p2Power) {
      winner = 1;
      this.state.game.currentTurn = 1;
    } else if (p2Power > p1Power) {
      winner = 2;
      this.state.game.currentTurn = 2;
    } else {
      // Tie - current turn stays the same (1)
      winner = 0;
      this.state.game.currentTurn = 1;
    }
    
    this.state.game.battleWinner = winner;
    this.state.game.battleDiff = diff;
    this.state.game.afterStarter = true;
    
    this.broadcast("starter_battle_result", {
      p1Card: p1CardId,
      p2Card: p2CardId,
      p1Power,
      p2Power,
      winner,
      diff,
      nextTurn: this.state.game.currentTurn
    });
    
    // Handle special abilities
    this.handleSpecialAbilities(p1CardId, p2CardId);
    
    // If there's a winner, allow them to choose operation
    if (winner > 0) {
      this.state.game.phase = "battle_choice";
      this.broadcast("battle_choice", {
        winner,
        diff,
        message: `Player ${winner}: Choose to add (+) or subtract (-) ${diff} points`
      });
    } else {
      this.finishStarterBattle();
    }
  }

  private resolveBattle() {
    const players = Array.from(this.state.players.values());
    const currentPlayer = players.find(p => p.playerId === this.state.game.currentTurn)!;
    const opponentPlayer = players.find(p => p.playerId !== this.state.game.currentTurn)!;
    
    const selfCardId = currentPlayer.hand[this.state.game.selectedSelf];
    const oppCardId = opponentPlayer.hand[this.state.game.selectedOpponent];
    
    const selfPower = this.getCardPower(selfCardId);
    const oppPower = this.getCardPower(oppCardId);
    
    const diff = Math.abs(selfPower - oppPower);
    const win = selfPower > oppPower;
    const tie = selfPower === oppPower;
    
    // Mark cards as used
    currentPlayer.usedCards[this.state.game.selectedSelf] = true;
    opponentPlayer.usedCards[this.state.game.selectedOpponent] = true;
    
    this.state.game.battleWinner = win ? this.state.game.currentTurn : (tie ? 0 : (this.state.game.currentTurn === 1 ? 2 : 1));
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
      tie
    });
    
    // Handle special abilities
    this.handleSpecialAbilities(selfCardId, oppCardId);
    
    if (win) {
      this.state.game.phase = "battle_choice";
      this.broadcast("battle_choice", {
        winner: this.state.game.currentTurn,
        diff,
        message: `Player ${this.state.game.currentTurn}: Choose to add (+) or subtract (-) ${diff} points`
      });
    } else {
      this.finishBattle();
    }
  }

  private handleSpecialAbilities(card1Id: number, card2Id: number) {
    // Dr. Manhattan ability - reveal opponent cards for 5 seconds
    if (card1Id === this.DR_MANHATTAN_ID || card2Id === this.DR_MANHATTAN_ID) {
      this.state.game.drManhattanActive = true;
      this.state.game.drManhattanTimeLeft = this.DR_MANHATTAN_DURATION;
      
      this.broadcast("dr_manhattan_activated", {
        duration: this.DR_MANHATTAN_DURATION
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
      diff
    });
    
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
      message: `Player ${this.state.game.currentTurn}: Choose your card`
    });
  }

  private finishBattle() {
    // Switch turn
    this.state.game.currentTurn = this.state.game.currentTurn === 1 ? 2 : 1;
    this.state.game.selectedSelf = -1;
    this.state.game.selectedOpponent = -1;
    this.state.game.phase = "choose_self";
    
    // Check if round is finished (counting used cards + starter blocks)
    const players = Array.from(this.state.players.values());
    const p1 = players.find(p => p.playerId === 1)!;
    const p2 = players.find(p => p.playerId === 2)!;
    
    const p1Used = p1.usedCards.filter(used => used).length + (this.state.game.starterP1Idx !== -1 ? 1 : 0);
    const p2Used = p2.usedCards.filter(used => used).length + (this.state.game.starterP2Idx !== -1 ? 1 : 0);
    
    if (p1Used >= 10 && p2Used >= 10) {
      this.finishRound();
    } else {
      this.broadcast("next_turn", {
        currentTurn: this.state.game.currentTurn,
        message: `Player ${this.state.game.currentTurn}: Choose your card`
      });
    }
  }

  private finishRound() {
    this.state.game.phase = "round_finished";
    
    // Determine round winner based on proximity to target score
    const players = Array.from(this.state.players.values());
    const p1 = players.find(p => p.playerId === 1)!;
    const p2 = players.find(p => p.playerId === 2)!;
    
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
      // Tie - split pot
      const halfPot = Math.floor(this.state.game.pot / 2);
      p1.credits += halfPot;
      p2.credits += this.state.game.pot - halfPot;
    }
    
    this.broadcast("round_finished", {
      winner: roundWinner,
      p1Score: p1.score,
      p2Score: p2.score,
      p1Credits: p1.credits,
      p2Credits: p2.credits,
      pot: this.state.game.pot
    });
    
    // Check for game end conditions
    if (p1.credits <= 0 || p2.credits <= 0) {
      this.endGame("busted");
    } else if (p1.credits >= 1000 || p2.credits >= 1000) {
      this.endGame("real_winner");
    } else {
      // Continue to next round
      setTimeout(() => {
        this.state.game.round++;
        this.startNewRound();
      }, 3000);
    }
  }

  private endGame(reason: string) {
    this.state.gameStatus = "finished";
    this.state.game.phase = "game_over";
    
    const players = Array.from(this.state.players.values());
    const p1 = players.find(p => p.playerId === 1)!;
    const p2 = players.find(p => p.playerId === 2)!;
    
    let winner = 0;
    if (reason === "busted") {
      winner = p1.credits > p2.credits ? 1 : 2;
    } else if (reason === "real_winner") {
      winner = p1.credits >= 1000 ? 1 : 2;
    } else if (reason === "deck_empty") {
      const p1Distance = Math.abs(p1.score - this.TARGET_SCORE);
      const p2Distance = Math.abs(p2.score - this.TARGET_SCORE);
      winner = p1Distance < p2Distance ? 1 : (p2Distance < p1Distance ? 2 : 0);
    }
    
    this.broadcast("game_over", {
      winner,
      reason,
      p1Score: p1.score,
      p2Score: p2.score,
      p1Credits: p1.credits,
      p2Credits: p2.credits
    });
    
    console.log(`🏁 Game ended - Winner: Player ${winner}, Reason: ${reason}`);
  }

  private handleReadyNextRound(client: Client) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    
    player.ready = true;
    
    const allReady = Array.from(this.state.players.values())
      .every(p => p.ready);
    
    if (allReady) {
      this.state.game.round++;
      this.startNewRound();
    }
  }

  private restartGame() {
    console.log("🔄 Restarting game...");
    
    this.clearTimers();
    
    // Reset all player states
    this.state.players.forEach(player => {
      player.score = 0;
      player.credits = 100;
      player.ready = false;
      player.bet = 0;
      player.betConfirmed = false;
      player.hand.clear();
      player.usedCards.clear();
      player.blockedCards.clear();
    });
    
    this.state.gameStatus = "playing";
    this.state.game.round = 1;
    this.initializeDeck();
    this.startNewRound();
  }

  private getCardPower(cardId: number): number {
    // Special case for Joker
    if (cardId === this.JOKER_ID) {
      return this.state.game.jokerValue;
    }
    
    // Regular cards: ID + 1 (so card 0 has power 1, card 1 has power 2, etc.)
    return cardId + 1;
  }

  private bestNewScore(currentScore: number, diff: number, preferredOp?: "+" | "-"): number {
    const target = this.TARGET_SCORE;
    const addResult = currentScore + diff;
    const subResult = currentScore - diff;
    
    const addDistance = Math.abs(addResult - target);
    const subDistance = Math.abs(subResult - target);
    
    if (preferredOp === "+") return addResult;
    if (preferredOp === "-") return subResult;
    
    // Choose operation that gets closer to target
    return addDistance <= subDistance ? addResult : subResult;
  }
}
