import { after } from "@vendetta/patcher";
import { findByProps, findByStoreName } from "@vendetta/metro";
import { storage } from "@vendetta/plugin";

storage.removeBanner ??= true;

let patches = [];
const sanitizedCache = new WeakMap();

const shallowClonePreserveProto = (obj) => {
  if (!obj || typeof obj !== "object") return obj;
  const clone = Object.create(Object.getPrototypeOf(obj));
  Object.assign(clone, obj);
  return clone;
};

const getSanitizedUser = (user) => {
  if (!user || typeof user !== "object") return user;
  if (!storage.removeBanner) return user;
  let cached = sanitizedCache.get(user);
  if (!cached) {
    cached = shallowClonePreserveProto(user);
    sanitizedCache.set(user, cached);
  } else {
    Object.assign(cached, user);
  }
  cached.banner = null;
  cached.bannerColor = null;
  cached.accentColor = cached.accentColor ?? null;
  return cached;
};

const getSanitizedProfile = (profile) => {
  if (!profile || typeof profile !== "object") return profile;
  if (!storage.removeBanner) return profile;
  let cached = sanitizedCache.get(profile);
  if (!cached) {
    cached = shallowClonePreserveProto(profile);
    sanitizedCache.set(profile, cached);
  } else {
    Object.assign(cached, profile);
  }
  cached.banner = null;
  if (cached.premiumGuildSince !== undefined) cached.themeColors = null;
  return cached;
};

const safe = (fn, fallback) => (...args) => {
  try {
    return fn(...args);
  } catch {
    return fallback;
  }
};

export default {
  onLoad() {
    const unloadPatches = () => patches.forEach((p) => p?.());
    const load = () => {
      unloadPatches();
      patches = [];

      const userStore = findByStoreName("UserStore");
      if (userStore?.getUser) {
        patches.push(
          after("getUser", userStore, safe((args, res) => {
            if (!res || !storage.removeBanner) return res;
            return getSanitizedUser(res);
          }, undefined))
        );
      }

      const userProfileStore = findByStoreName("UserProfileStore");
      if (userProfileStore?.getUserProfile) {
        patches.push(
          after("getUserProfile", userProfileStore, safe((args, res) => {
            if (!res || !storage.removeBanner) return res;
            return getSanitizedProfile(res);
          }, undefined))
        );
      }

      const bannerUrlMod = findByProps("getUserBannerURL", "getUserAvatarURL");
      if (bannerUrlMod?.getUserBannerURL) {
        patches.push(
          after("getUserBannerURL", bannerUrlMod, safe((args, url) =>
            storage.removeBanner ? null : url
          , undefined))
        );
      }

      const hookMod = findByProps("useUser", "useUserBanner");
      if (hookMod) {
        if (hookMod.useUser) {
          patches.push(
            after("useUser", hookMod, safe((args, res) => {
              if (!res || !storage.removeBanner) return res;
              return getSanitizedUser(res);
            }, undefined))
          );
        }
        if (hookMod.useUserBanner) {
          patches.push(
            after("useUserBanner", hookMod, safe((args, url) =>
              storage.removeBanner ? null : url
            , undefined))
          );
        }
      }
    };
    load();
  },
  onUnload() {
    patches.forEach((p) => p?.());
  },
};
