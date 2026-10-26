// Kept as a single import point; the real drawing code lives in src/cards/.
const { renderMatchCard } = require('../cards/matchCard');
const { renderProfileCard } = require('../cards/profileCard');
const { renderTeamCard } = require('../cards/teamCard');
const { renderBeltCard } = require('../cards/beltCard');

module.exports = { renderMatchCard, renderProfileCard, renderTeamCard, renderBeltCard };
module.exports.renderShowCard = require('../cards/showCard').renderShowCard;
module.exports.renderTapeCard = require('../cards/tapeCard').renderTapeCard;
module.exports.renderLineageCard = require('../cards/lineageCard').renderLineageCard;
module.exports.renderFactionCard = require('../cards/factionCard').renderFactionCard;
module.exports.renderHofCard = require('../cards/hofCard').renderHofCard;
module.exports.renderRankingsCard = require('../cards/rankingsCard').renderRankingsCard;
module.exports.renderPlayerCard = require('../cards/playerCard').renderPlayerCard;
module.exports.renderSeasonCard = require('../cards/seasonCard').renderSeasonCard;
module.exports.renderCareerCard = require('../cards/careerCard').renderCareerCard;
module.exports.renderBracketCard = require('../cards/bracketCard').renderBracketCard;
module.exports.renderContractCard = require('../cards/contractCard').renderContractCard;
