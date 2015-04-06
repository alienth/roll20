(function (shaped, undefined) {

	/* Options */
	shaped.createAbilityAsToken = true;
	shaped.monsterAsMinHp = true; // generated token hp can't be lower than the average hp
	shaped.rollMonsterHpOnDrop = true; // will roll HP when character are dropped on map

	/* Setting these to a sheet value will set the token bar value. If they are set to '' or not set then it will use whatever you already have set on the token
		 For a full list of attributes please look at https://app.roll20.net/forum/post/1734923/new-d-and-d-5e-shaped-character-sheet#post-1788863
		 Do not use npc_HP, use HP instead
	*/
	// Green bar
	shaped.parsebar1 = 'npc_AC';
	// Blue bar
	shaped.parsebar2 = ''; //'passive_perception'
	// Red bar
	shaped.parsebar3 = 'HP';  //'speed'



	shaped.statblock = {
		version: '1.4',
		RegisterHandlers: function () {
			on('chat:message', HandleInput);

			if(shaped.rollMonsterHpOnDrop) {
				on("add:graphic", function(obj) {
					shaped.rollTokenHp(obj);
				});
			}

			log('Shaped Scripts ready');
		}
	};

	var status = '',
			errors = [],
			obj = null,
			characterId = null;

	function HandleInput(msg) {
		if(msg.type !== 'api') {
			return;
		}
		log('msg.content' + msg.content);
		args = msg.content.split(/\s+/);
		switch(args[0]) {
			case '!shaped-import':
				shaped.getSelectedToken(msg, shaped.ImportStatblock);
				break;
			case '!shaped-rollhp':
				return shaped.rollHpForSelectedToken(msg);
				break;
			case '!shaped-convert':
				shaped.getSelectedToken(msg, shaped.parseOldToNew);
				break;
		}
	}

	shaped.getSelectedToken = shaped.getSelectedToken || function(msg, callback, limit) {
		try {
			if(!msg.selected || !msg.selected.length) {
				throw('No token selected');
			}

			limit = parseInt(limit, 10) || 0;

			if(!limit || limit > msg.selected.length + 1 || limit < 1) {
				limit = msg.selected.length;
			}

			for(i = 0; i < limit; i++) {
				if(msg.selected[i]._type === 'graphic') {
					var obj = getObj('graphic', msg.selected[i]._id);
					if(obj && obj.get('subtype') === 'token') {
						callback(obj);
					}
				}
			}
		} catch(e) {
			log(e);
			log('Exception: ' + e);
			sendChat('GM', '/w GM ' + e);
		}
	};

	shaped.rollHpForSelectedToken = function(msg) {
		shaped.getSelectedToken(msg, shaped.rollTokenHp);
	};

	shaped.rollTokenHp = function(token) {
		var number = 0;
		for(i = 1; i < 4; i++) {
			if(shaped['parsebar' + i] === 'HP') {
				number = i;
				break;
			}
		}
		if(number === 0) {
			throw('One of the shaped.parsebar option has to be set to "HP" for random HP roll');
		}

		var bar = 'bar' + number;
		var represent = '';
		try {
			if((represent = token.get('represents')) === '') {
				throw('Token does not represent a character');
			}

			if(token.get(bar + '_link') !== '') {
				throw('Token ' + bar + ' is linked');
			}

			rollCharacterHp(represent, function(total, original) {
				token.set(bar + '_value', total);
				token.set(bar + '_max', total);
				var message = '/w GM Hp rolled: ' + total;
				if(original > 0) {
					message += ' ajusted from original result of ' + original;
				}
				sendChat('GM', message);
			});
		} catch(e) {
			log('Exception: ' + e);
		}
	};

	function rollCharacterHp(id, callback) {
		var hd = getAttrByName(id, 'npc_HP_hit_dice', 'current');
		if(hd === '') {
			throw 'Character has no HP Hit Dice defined';
		}

		var match = hd.match(/^(\d+)d(\d+)$/);
		if(!match || !match[1] || !match[2]) {
			throw 'Character doesn\'t have valid HP Hit Dice format';
		}

		var nb_dice = parseInt(match[1], 10);
		var nb_face = parseInt(match[2], 10);
		var total = 0;
		var original = 0;

		sendChat('GM', '/roll ' + hd, function(ops) {
			var rollResult = JSON.parse(ops[0].content);
			if(_.has(rollResult, 'total')) {
				total = rollResult.total;

				// Add Con modifier x number of hit dice
				var constitution_mod = Math.floor((getAttrByName(id, 'constitution', 'current') - 10) / 2);
				total = Math.floor(nb_dice * constitution_mod + total);

				if(shaped.monsterAsMinHp) {
					// Calculate average HP, has written in statblock.
					var average_hp = Math.floor(((nb_face + 1) / 2 + constitution_mod) * nb_dice);
					if(average_hp > total) {
						original = total;
						total = average_hp;
					}
				}
				callback(total, original);
			}
		});
	}

	shaped.capitalizeEachWord = function(str) {
		return str.replace(/\w\S*/g, function(txt) {
			return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();
		});
	};

	shaped.setCharacter = function(name, gmnotes, bio) {
		if(!name) {
			throw('Name require to get or create character');
		}
		name = shaped.capitalizeEachWord(name);

		var obj = findObjs({
			_type: 'character',
			name: name
		});

		if(obj.length === 0) {
			obj = createObj('character', {
				name: name
			});
			status = 'Character ' + name + ' created';
		} else {
			obj = getObj('character', obj[0].id);
			status = 'Character ' + name + ' updated';
		}

		if(!obj) {
			throw('Something prevent script to create or find character ' + name);
		}

		if(gmnotes)
			obj.set({
				gmnotes: gmnotes
			});

		if(bio)
			obj.set({
				bio: bio
			});

		characterId = obj.id;
		setAttribute('is_npc', 1);

		return obj;
	};

	shaped.ImportStatblock = function(token) {
		status = 'Nothing modified';
		errors = [];
		try {
			var statblock = token.get('gmnotes').trim();

			if(statblock === '') {
				throw('Selected token GM Notes was empty.');
			}

			var name = shaped.parseStatblock(statblock);
			if(characterId) {
				token.set('represents', characterId);
				token.set('name', name);

				processBarSetting(1, token, name);
				processBarSetting(2, token, name);
				processBarSetting(3, token, name);

			}
		} catch(e) {
			status = 'Parsing was incomplete due to error(s)';
			log(e);
			errors.push(e);
		}

		log(status);
		sendChat('Shaped', '/w GM ' + status);

		if(errors.length > 0) {
			log(errors.join('\n'));
			sendChat('Shaped', '/w GM Error(s):\n/w GM ' + errors.join('\n/w GM '));
		}
	};

	function setAttribute(name, currentVal, max) {
		if(!name) {
			throw('Name required to set attribute');
		}

		max = max || '';

		if(!currentVal) {
			log('Error setting empty value: ' + name);
			return;
		}

		var attr = findObjs({
			_type: 'attribute',
			_characterid: characterId,
			name: name
		})[0];

		if(!attr) {
			log('Creating attribute ' + name);
			createObj('attribute', {
				name: name,
				current: currentVal,
				max: max,
				characterid: characterId
			});
		} else if(!attr.get('current') || attr.get('current').toString() !== currentVal) {
			log('Updating attribute ' + name);
			attr.set({
				current: currentVal,
				max: max
			});
		}
	}

	function setAbility(name, description, action, istokenaction) {
		if(!name) {
			throw('Name required to set ability');
		}

		var ability = findObjs({
			_type: 'ability',
			_characterid: characterId,
			name: name
		});

		if(!ability) {
			throw('Something prevent script to create or find ability ' + name);
		}

		if(ability.length === 0) {
			ability = createObj('ability', {
				_characterid: characterId,
				name: name,
				description: description,
				action: action,
				istokenaction: istokenaction
			});
			log('Ability ' + name + ' created');
		} else {
			ability = getObj('ability', ability[0].id);
			if(ability.get('description') != description || ability.get('action') !== action || ability.get('istokenaction') != istokenaction) {
				ability.set({
					description: description,
					action: action,
					istokenaction: istokenaction
				});
				log('Ability ' + name + ' updated');
			}
		}
	}

	shaped.parseStatblock = function(statblock) {
		log('---- Parsing statblock ----');

		text = clean(statblock);
		var keyword = findKeyword(text);
		var section = splitStatblock(text, keyword);
		shaped.setCharacter(section.attr.name, '', section.bio);
		processSection(section);
		return section.attr.name;
	};

	function clean(statblock) {
		statblock = unescape(statblock);
		statblock = statblock.replace(/–/g, '-');
		statblock = statblock.replace(/<br[^>]*>/g, '#').replace(/(<([^>]+)>)/ig, '');
		statblock = statblock.replace(/\s+#\s+/g, '#');
		statblock = statblock.replace(/#(?=[a-z])/g, ' ');
		statblock = statblock.replace(/\s+/g, ' ');

		//log(statblock)  ;
		return statblock;
	}

	function findKeyword(statblock) {
		var keyword = {
			attr: {},
			traits: {},
			actions: {},
			legendary: {}
		};

		var indexAction = 0;
		var indexLegendary = statblock.length;

		// Standard keyword
		var regex = /#\s*(tiny|small|medium|large|huge|gargantuan|armor class|hit points|speed|str|dex|con|int|wis|cha|saving throws|skills|damage resistances|damage immunities|condition immunities|damage vulnerabilities|senses|languages|challenge|traits|actions|legendary actions)(?=\s|#)/gi;
		while(match = regex.exec(statblock)) {
			key = match[1].toLowerCase();

			if(key === 'actions') {
				indexAction = match.index;
				keyword.actions.Actions = match.index;
			} else if(key === 'legendary actions') {
				indexLegendary = match.index;
				keyword.legendary.Legendary = match.index;
			} else {
				keyword.attr[key] = match.index;
			}
		}

		// Power
		regex = /(?:#|\.\s+)([A-Z][\w-]+(?:\s(?:[A-Z][\w-]+|[\(\)\d/-]|of)+)*)(?=\s*\.)/g;
		while(match = regex.exec(statblock)) {
			if(!keyword.attr[match[1].toLowerCase()]) {
				if(match.index < indexAction) {
					keyword.traits[match[1]] = match.index;
				} else if(match.index < indexLegendary) {
					keyword.actions[match[1]] = match.index;
				} else {
					keyword.legendary[match[1]] = match.index;
				}
			}
		}

		return keyword;
	}

	function splitStatblock(statblock, keyword) {
		// Check for bio (flavor text) at the end, separated by at least 3 line break.
		var bio;
		if((pos = statblock.indexOf('###')) != -1) {
			bio = statblock.substring(pos + 3).replace(/^[#\s]/g, '');
			bio = bio.replace(/#/g, '<br>').trim();
			statblock = statblock.slice(0, pos);
		}

		var debut = 0;
		var keyName = 'name';
		var sectionName = 'attr';

		for(var section in keyword) {
			var obj = keyword[section];
			for(var key in obj) {
				var fin = parseInt(obj[key], 10);
				keyword[sectionName][keyName] = extractSection(statblock, debut, fin, keyName);
				keyName = key;
				debut = fin;
				sectionName = section;
			}
		}
		keyword[sectionName][keyName] = extractSection(statblock, debut, statblock.length, keyName);

		delete keyword.actions.Actions;
		delete keyword.legendary.Legendary;

		if(bio) {
			keyword.bio = bio;
		}

		// Patch for multiline abilities
		var abilitiesName = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
		var abilities = '';
		for(i = 0, len = abilitiesName.length; i < len; ++i) {
			if(keyword.attr[abilitiesName[i]]) {
				abilities += keyword.attr[abilitiesName[i]] + ' ';
				delete keyword.attr[abilitiesName[i]];
			}
		}
		keyword.attr.abilities = abilities;

		// Size attribute:
		var size = ['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan'];
		for(i = 0, len = abilitiesName.length; i < len; ++i) {
			if(keyword.attr[size[i]]) {
				keyword.attr.size = size[i] + ' ' + keyword.attr[size[i]];
				delete keyword.attr[size[i]];
				break;
			}
		}

		//Move legendary action summary to trait.
		if(keyword.legendary['Legendary Actions'] !== undefined) {
			keyword.traits['Legendary Actions'] = keyword.legendary['Legendary Actions'];
			delete keyword.legendary['Legendary Actions'];
		}
		return keyword;
	}

	function extractSection(text, debut, fin, title) {
		section = text.substring(debut, fin);
		// Remove action name from action description and clean.
		section = section.replace(new RegExp('^[\\s\\.#]*' + title.replace(/([-()\\/])/g, '\\$1') + '?[\\s\\.#]*', 'i'), '');
		section = section.replace(/#/g, ' ');
		return section;
	}

	function processSection(section) {
		// Process abilities first cause needed by other attribute.
		if('abilities' in section.attr) parseAbilities(section.attr.abilities);
		if('size' in section.attr) parseSize(section.attr.size);
		if('armor class' in section.attr) parseArmorClass(section.attr['armor class']);
		if('hit points' in section.attr) parseHp(section.attr['hit points']);
		if('speed' in section.attr) parseSpeed(section.attr.speed);
		if('challenge' in section.attr) parseChallenge(section.attr.challenge);
		if('saving throws' in section.attr) parseSavingThrow(section.attr['saving throws']);
		if('skills' in section.attr) parseSkills(section.attr.skills);
		if('senses' in section.attr) parseSenses(section.attr.senses);

		if('damage immunities' in section.attr) setAttribute('damage_immunity', section.attr['damage immunities']);
		if('condition immunities' in section.attr) setAttribute('condition_immunity', section.attr['condition immunities']);
		if('damage vulnerabilities' in section.attr) setAttribute('damage_vulnerability', section.attr['damage vulnerabilities']);
		if('damage resistances' in section.attr) setAttribute('damage_resistance', section.attr['damage resistances']);
		if('languages' in section.attr) setAttribute('prolanguages', section.attr.languages);

		parseTraits(section.traits);
		parseActions(section.actions, section.legendary);
	}

	/* Section parsing function */
	function parseAbilities(abilities) {
		var regex = /(\d+)\s*\(/g;
		var match = [];

		while(matches = regex.exec(abilities)) {
			match.push(matches[1]);
		}

		setAttribute('strength', match[0]);
		setAttribute('dexterity', match[1]);
		setAttribute('constitution', match[2]);
		setAttribute('intelligence', match[3]);
		setAttribute('wisdom', match[4]);
		setAttribute('charisma', match[5]);
	}

	function parseSize(size) {
		var match = size.match(/(.*?) (.*?), (.*)/i);
		setAttribute('size', shaped.capitalizeEachWord(match[1]));
		setAttribute('npc_type', shaped.capitalizeEachWord(match[2]));
		setAttribute('alignment', shaped.capitalizeEachWord(match[3]));
	}

	function parseArmorClass(ac) {
		var match = ac.match(/(\d+)\s?(.*)/);
		setAttribute('npc_AC', match[1]);
		setAttribute('npc_AC_note', match[2].replace(/\(|\)/g,''));
	}

	function parseHp(hp) {
		var match = hp.match(/.*?(\d+)\s+\(((?:\d+)d(?:\d+))/i);
		setAttribute('HP', match[1], match[1]);
		log('hd note' + match[2]);
		setAttribute('npc_HP_hit_dice', match[2]);
	}

	function parseSpeed(speed) {
		var baseAttr = 'speed',
				regex = /(|fly|climb|swim|burrow)\s*(\d+)(?:ft\.|\s)+(\(.*\))?/gi;
		while(match = regex.exec(speed)) {
			var attrName = baseAttr + (match[1] !== '' ? '_' + match[1].toLowerCase() : ''),
					value = match[2];
			if(match[3]) {
				value += ' ' + match[3];
			}

			setAttribute(attrName, value);
		}
	}

	function parseChallenge(cr) {
		input = cr.replace(/[, ]/g, '');
		var match = input.match(/([\d/]+).*?(\d+)/);
		setAttribute('challenge', match[1]);
		setAttribute('xp', parseInt(match[2]));
	}

	function parseSavingThrow(save) {
		var regex = /(STR|DEX|CON|INT|WIS|CHA).*?(\d+)/gi;
		var attr, value;
		while(match = regex.exec(save)) {
			// Substract ability modifier from this field since sheet computes it
			switch(match[1].toLowerCase()) {
				case 'str':
					attr = 'strength';
					break;
				case 'dex':
					attr = 'dexterity';
					break;
				case 'con':
					attr = 'constitution';
					break;
				case 'int':
					attr = 'intelligence';
					break;
				case 'wis':
					attr = 'wisdom';
					break;
				case 'cha':
					attr = 'charisma';
					break;
			}
			setAttribute(attr + '_save_bonus', match[2] - Math.floor((getAttrByName(characterId, attr) - 10) / 2));
		}
	}

	function parseSkills(skills) {
		// Need to substract ability modifier skills this field since sheet compute it
		var skillAbility = {
			acrobatics: 'dexterity',
			'animal handling': 'wisdom',
			arcana: 'intelligence',
			athletics: 'strength',
			deception: 'charisma',
			history: 'intelligence',
			insight: 'wisdom',
			intimidation: 'charisma',
			investigation: 'intelligence',
			medicine: 'wisdom',
			nature: 'intelligence',
			perception: 'wisdom',
			performance: 'charisma',
			persuasion: 'charisma',
			religion: 'intelligence',
			'sleight of hand': 'dexterity',
			stealth: 'dexterity',
			survival: 'wisdom'
		};

		var regex = /([\w\s]+).*?(\d+)/gi;
		while(match = regex.exec(skills.replace(/Skills\s+/i, ''))) {
			var skill = match[1].trim().toLowerCase();
			if(skill in skillAbility) {
				var abilitymod = skillAbility[skill],
						attr = skill.replace(/\s/g, '') + '_bonus';
				setAttribute(attr, match[2] - Math.floor((getAttrByName(characterId, abilitymod) - 10) / 2));
			} else {
				errors.push('Skill ' + skill + ' is not a valid skill');
			}
		}
	}

	function parseSenses(senses) {
		senses = senses.replace(/[,\s]*passive.*/i,'').replace(/\./g,'').split(', ');

		for (var i = 0; i < senses.length; i++) {
			var splitValue = senses[i].split(' ');

			setAttribute(splitValue[0], splitValue[1]);
			if(splitValue[2].indexOf("blind beyond")) {
				setAttribute('blindsight_blind_beyond', 'on');
			}
		}
	}

	function parseTraits(traits) {
		var text = '';
		_.each(traits, function(value, key) {
			value = value.replace(/[\.\s]+$/, '.');
			text += '**' + key + '**: ' + value + ' ';
		});

		text = text.slice(0, -1);
		setAttribute('npc_traits', text);
	}

	function parseActions(actions, legendary) {

		var multiattackText = '';
		var actionPosition = []; // For use with multiattack.

		if('Multiattack' in actions) {
			setAttribute('npc_multiattack', actions.Multiattack);
			multiattackText = actions.Multiattack;
			delete actions.Multiattack;
		}

		var cpt = 1;
		_.each(actions, function(value, key) {
			if((pos = key.indexOf('(')) > 1) {
				actionPosition[cpt] = key.substring(0, pos - 1).toLowerCase();
			} else {
				actionPosition[cpt] = key.toLowerCase();
			}

			setAttribute('npc_action_name' + cpt, key);

			// Convert dice to inline roll and split description from effect
			var match = value.match(/(Each|Hit:)/);
			if(match) {
				text = value.substring(0, match.index).replace(/(\+\s?(\d+))/g, '$1 : [[1d20+$2]]|[[1d20+$2]]');
				setAttribute('npc_action_description' + cpt, text);

				text = value.substring(match.index).replace(/(\d+d\d+[\d\s+]*)/g, '[[$1]]');
				setAttribute('npc_action_effect' + cpt, text);
			} else {
				text = value.replace(/(\+\s?(\d+))/g, '$1 : [[1d20+$2]]|[[1d20+$2]]');
				setAttribute('npc_action_description' + cpt, text);
			}

			// Create token action
			if(shaped.usePowerAbility) {
				setAbility(key, '', powercardAbility(id, cpt), shaped.createAbilityAsToken);
			} else {
				setAbility(key, '', '%{selected|NPCAction' + cpt + '}', shaped.createAbilityAsToken);
			}

			cpt++;
		});

		var actionList = actionPosition.join('|').slice(1);

		if(multiattackText !== '') {
			//var regex = new RegExp('(?:(?:(one|two) with its )?(' + actionList + '))', 'gi');
			var regex = new RegExp('(one|two)? (?:with its )?(' + actionList + ')', 'gi');
			var macro = '';

			while(match = regex.exec(multiattackText)) {
				var action = match[2];
				var nb = match[1] || 'one';
				var actionNumber = actionPosition.indexOf(action.toLowerCase());

				if(actionNumber !== -1) {
					macro += '%{selected|NPCAction' + actionNumber + '}\n';
					if(nb == 'two') {
						macro += '%{selected|NPCAction' + actionNumber + '}\n';
					}
					delete actionPosition[actionNumber]; // Remove
				}
			}

			setAttribute('npc_action_name' + cpt, 'MultiAttack');
			setAttribute('npc_action_effect' + cpt, macro.slice(0, -1));
			setAttribute('npc_action_multiattack' + cpt, '{{npc_showmultiattack=1}} {{npc_multiattack=@{npc_multiattack}}}');

			if(shaped.usePowerAbility) {
				setAbility('MultiAttack', '', powercardAbility(id, cpt), shaped.createAbilityAsToken);
			} else {
				setAbility('MultiAttack', '', '%{selected|NPCAction' + cpt + '}', shaped.createAbilityAsToken);
			}
			cpt++;
		}

		_.each(legendary, function(value, key) {
			setAttribute('npc_action_name' + cpt, key);
			setAttribute('npc_action_type' + cpt, '(Legendary Action)');

			var regex = new RegExp('makes a (' + actionList + ')', 'i');
			var match = value.match(regex);
			if(match) {
				var macro = '%{selected|NPCAction' + actionPosition.indexOf(match[1].toLowerCase()) + '}';
				setAttribute('npc_action_effect' + cpt, macro);
			} else {
				match = value.match(/(Each|Hit:)/);
				if(match) {
					text = value.substring(0, match.index).replace(/(\+\s?(\d+))/g, '$1 : [[1d20+$2]]|[[1d20+$2]]');
					setAttribute('npc_action_description' + cpt, text);

					text = value.substring(match.index).replace(/(\d+d\d+[\d\s+]*)/g, '[[$1]]');
					setAttribute('npc_action_effect' + cpt, text);
				} else {
					text = value.replace(/(\+\s?(\d+))/g, '$1 : [[1d20+$2]]|[[1d20+$2]]');
					setAttribute('npc_action_description' + cpt, text);
				}
			}
			cpt++;
		});
	}

	function processBarSetting(i, token, name) {
		var attribute = shaped['parsebar' + i];

		log('Attribute to set to bar ' + i + ': ' + attribute);

		if(attribute && attribute !== '') {
			//value = getAttrByName(characterId, attribute, 'current');
			var command = '\\w GM [[@{' + name + '|'+ attribute + '}]]';
			sendChat('Shaped', command, function(ops) {
				var res = ops[0].inlinerolls['1'].results.total;
				log(res);
				setBarValue(token, i, res);
				//log(res);
			});
		}
	}

	function setBarValue(token, barNumber, value) {
		if(value && value !== '') {
			var bar = 'bar' + barNumber;
			log('Setting ' + bar + ' to value ' + value);
			token.set(bar + '_value', value);
			token.set(bar + '_max', value);
		} else {
			log("Can't set empty value to bar " + barNumber);
		}
	}


	function convertAttrFromNPCtoPC(npc_attr_name, attr_name) {
		var npc_attr = getAttrByName(characterId, npc_attr_name),
				attr = getAttrByName(characterId, attr_name);
		if(npc_attr && !attr) {
			log('convert from ' + npc_attr_name + ' to ' + attr_name);
			setAttribute(attr_name, npc_attr);
		}
	}

	shaped.parseOldToNew = function(token) {
		log('---- Parsing old attributes to new ----');

		obj = findObjs({
			_type: 'character',
			name: token.attributes.name
		})[0];
		characterId = obj.id;


		convertAttrFromNPCtoPC('npc_initiative', 'initiative');
		convertAttrFromNPCtoPC('npc_initiative_overall', 'initiative_overall');



		convertAttrFromNPCtoPC('npc_strength', 'strength');
		convertAttrFromNPCtoPC('npc_strength_save_bonus', 'strength_save_bonus');
		convertAttrFromNPCtoPC('npc_basic_strength_bonus', 'basic_strength_bonus');
		convertAttrFromNPCtoPC('npc_dexterity', 'dexterity');
		convertAttrFromNPCtoPC('npc_dexterity_save_bonus', 'dexterity_save_bonus');
		convertAttrFromNPCtoPC('npc_basic_dexterity_bonus', 'basic_dexterity_bonus');
		convertAttrFromNPCtoPC('npc_constitution', 'constitution');
		convertAttrFromNPCtoPC('npc_constitution_save_bonus', 'constitution_save_bonus');
		convertAttrFromNPCtoPC('npc_basic_constitution_bonus', 'basic_constitution_bonus');
		convertAttrFromNPCtoPC('npc_intelligence', 'intelligence');
		convertAttrFromNPCtoPC('npc_intelligence_save_bonus', 'intelligence_save_bonus');
		convertAttrFromNPCtoPC('npc_basic_intelligence_bonus', 'basic_intelligence_bonus');
		convertAttrFromNPCtoPC('npc_wisdom', 'wisdom');
		convertAttrFromNPCtoPC('npc_wisdom_save_bonus', 'wisdom_save_bonus');
		convertAttrFromNPCtoPC('npc_basic_wisdom_bonus', 'basic_wisdom_bonus');
		convertAttrFromNPCtoPC('npc_charisma', 'charisma');
		convertAttrFromNPCtoPC('npc_charisma_save_bonus', 'charisma_save_bonus');
		convertAttrFromNPCtoPC('npc_basic_charisma_bonus', 'basic_charisma_bonus');



		convertAttrFromNPCtoPC('npc_alignment', 'alignment');


		var npc_HP = getAttrByName(characterId, 'npc_HP'),
				HP = getAttrByName(characterId, 'HP'),
				npc_HP_max = getAttrByName(characterId, 'npc_HP', 'max'),
				HP_max = getAttrByName(characterId, 'HP', 'max');
		if(npc_HP && !HP && npc_HP_max && !HP_max) {
			setAttribute('HP', npc_HP, npc_HP_max);
		} else if (npc_HP && !HP) {
			setAttribute('HP', npc_HP);
		} else if (npc_HP_max && !HP_max) {
			setAttribute('HP', 0, npc_HP_max);
		}
		convertAttrFromNPCtoPC('npc_temp_HP', 'temp_HP');



		convertAttrFromNPCtoPC('npc_speed', 'speed');
		convertAttrFromNPCtoPC('npc_speed_fly', 'speed_fly');
		convertAttrFromNPCtoPC('npc_speed_climb', 'speed_climb');
		convertAttrFromNPCtoPC('npc_speed_swim', 'speed_swim');



		convertAttrFromNPCtoPC('npc_xp', 'xp');
		convertAttrFromNPCtoPC('npc_challenge', 'challenge');
		convertAttrFromNPCtoPC('npc_size', 'size');
		convertAttrFromNPCtoPC('npc_senses', 'vision');
		convertAttrFromNPCtoPC('npc_languages', 'prolanguages');



		convertAttrFromNPCtoPC('npc_damage_resistance', 'damage_resistance');
		convertAttrFromNPCtoPC('npc_damage_vulnerability', 'damage_vulnerability');
		convertAttrFromNPCtoPC('npc_damage_immunity', 'damage_immunity');
		convertAttrFromNPCtoPC('npc_condition_immunity', 'condition_immunity');



		convertAttrFromNPCtoPC('npc_acrobatics_bonus', 'acrobatics_bonus');
		convertAttrFromNPCtoPC('npc_animalhandling_bonus', 'animalhandling_bonus');
		convertAttrFromNPCtoPC('npc_arcana_bonus', 'arcana_bonus');
		convertAttrFromNPCtoPC('npc_athletics_bonus', 'athletics_bonus');
		convertAttrFromNPCtoPC('npc_deception_bonus', 'deception_bonus');
		convertAttrFromNPCtoPC('npc_history_bonus', 'history_bonus');
		convertAttrFromNPCtoPC('npc_insight_bonus', 'insight_bonus');
		convertAttrFromNPCtoPC('npc_intimidation_bonus', 'intimidation_bonus');
		convertAttrFromNPCtoPC('npc_investigation_bonus', 'investigation_bonus');
		convertAttrFromNPCtoPC('npc_medicine_bonus', 'medicine_bonus');
		convertAttrFromNPCtoPC('npc_nature_bonus', 'nature_bonus');
		convertAttrFromNPCtoPC('npc_perception_bonus', 'perception_bonus');
		convertAttrFromNPCtoPC('npc_performance_bonus', 'performance_bonus');
		convertAttrFromNPCtoPC('npc_persuasion_bonus', 'persuasion_bonus');
		convertAttrFromNPCtoPC('npc_religion_bonus', 'religion_bonus');
		convertAttrFromNPCtoPC('npc_sleightofhand_bonus', 'sleightofhand_bonus');
		convertAttrFromNPCtoPC('npc_stealth_bonus', 'stealth_bonus');
		convertAttrFromNPCtoPC('npc_survival_bonus', 'survival_bonus');

		shaped.setBars(token);
	};

	function setBarValueAfterConvert(token, bar, obj) {
		if(obj) {
			log('Setting ' + bar + ' to: id: ' + obj.id + ' current: ' + obj.attributes.current + ' max: ' + obj.attributes.max);
			if(obj.attributes.current) {
				token.set(bar + '_value', obj.attributes.current);
			}
			if(obj.attributes.max) {
				token.set(bar + '_max', obj.attributes.max);
			}
			if(obj.id) {
				token.set(bar + '_link', obj.id);
			}
		} else {
			log("Can't set empty object to bar " + bar);
		}
	}

	function getAndSetBarInfo(token, bar) {
		var bar_link = token.get(bar + '_link');
		if(!bar_link) {
			var parsebar = shaped['parse' + bar];
			log('parsebar: ' + parsebar);
			if(parsebar) {
				var objOfParsebar = findObjs({
					name: parsebar,
					_type: 'attribute',
					_characterid: characterId
				}, {caseInsensitive: true})[0];
				setBarValueAfterConvert(token, bar, objOfParsebar);
			}
		} else {
			objOfBar = {
				id: bar_link,
				attributes: {}
			};
			var bar_value = token.get(bar + '_value');
			if(bar_value) {
				objOfBar.attributes.value = bar_value;
			}
			var bar_max = token.get(bar + '_max');
			if(bar_max) {
				objOfBar.attributes.max = bar_max;
			}
			setBarValueAfterConvert(token, bar, objOfBar);
		}
	}

	shaped.setBars = function(token) {
		log('set bars');

		getAndSetBarInfo(token, 'bar1');
		getAndSetBarInfo(token, 'bar2');
		getAndSetBarInfo(token, 'bar3');
	};

}(typeof shaped === 'undefined' ? shaped = {} : shaped));

on('ready', function() {
	'use strict';
	shaped.statblock.RegisterHandlers();
});