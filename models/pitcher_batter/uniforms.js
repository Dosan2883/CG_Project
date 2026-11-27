'use strict';

// [역할 2] 기본 텍스처와 팀별 유니폼
(function () {
  const pb = window.PITCHER_BATTER;
  const { pitcher, batter } = pb.outfitParts;
  const imageCache = new Map();
  const tintCache = new Map();
  const activeTeams = new WeakMap();

  function loadImage(path) {
    if (!imageCache.has(path)) {
      imageCache.set(path, new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = path;
      }));
    }
    return imageCache.get(path);
  }

  function tint(path, color) {
    const key = `${path}|${color.join(',')}`;
    if (!tintCache.has(key)) {
      tintCache.set(key, loadImage(path).then((image) => {
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(image, 0, 0);
        ctx.globalCompositeOperation = 'multiply';
        ctx.fillStyle = `rgb(${color.join(',')})`;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        return canvas.toDataURL('image/png');
      }).catch(() => null)); // 로딩 실패 시 모델의 팀 색상으로 출력
    }
    return tintCache.get(key);
  }

  function assignTexture(parts, name) {
    for (const part of parts) part.texture = `textures/${name}.png`;
  }

  function applyOutfit(outfit, role, headgear, team) {
    const jersey = team?.color ?? outfit.jersey[0].color;
    const cap = team?.cap ?? outfit[headgear][0].color;
    const version = {};
    activeTeams.set(outfit, version);
    for (const [parts, name, color] of [
      [outfit.jersey, `${role}_uniform`, jersey],
      [outfit[headgear], `${role}_${headgear}`, cap],
    ]) {
      for (const part of parts) {
        part.color = color;
        part.texture = undefined;
      }
      tint(`textures/${name}.png`, color).then((texture) => {
        if (texture && activeTeams.get(outfit) === version) {
          for (const part of parts) part.texture = texture;
        }
      });
    }
    for (const patch of outfit.patches) patch.visible = Boolean(team?.mark);
    for (const decal of outfit.decals) {
      decal.visible = Boolean(team?.mark);
      decal.texture = team?.mark;
      decal.meshScale[0] = decal.decalHeight * (team?.markAspect ?? 1);
    }
  }

  const applyPitcherUniform = (team) => applyOutfit(pitcher, 'pitcher', 'cap', team);
  const applyBatterUniform = (team) => applyOutfit(batter, 'batter', 'helmet', team);

  function applyTeamUniforms(battingTeam, fieldingTeam) {
    applyBatterUniform(battingTeam);
    applyPitcherUniform(fieldingTeam);
  }

  function applyBaseTextures() {
    assignTexture(pitcher.pants, 'pitcher_pants');
    assignTexture(pitcher.glove, 'pitcher_glove');
    assignTexture(batter.pants, 'batter_pants');
    assignTexture(batter.bat, 'batter_bat');
    assignTexture([...pitcher.skin, ...batter.skin], 'player_skin');
    assignTexture([pb.ball], 'baseball');
  }

  Object.assign(pb, { applyBaseTextures, applyPitcherUniform, applyBatterUniform, applyTeamUniforms });
  applyBaseTextures();
  applyTeamUniforms();
})();
