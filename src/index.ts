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

export default {
  onLoad() {
    const unloadPatches = () => patches.forEach((p) => p?.());
    const load = () => {
      unloadPatches();
      patches = [];

      [findByProps("getUser"), findByStoreName("UserStore")]
        .filter(Boolean)
        .forEach((store) => {
          if (!store.getUser) return;
          patches.push(
            after("getUser", store, (args, res) => {
              if (!res || !storage.removeBanner) return res;
              return getSanitizedUser(res);
            })
          );
        });

      [findByProps("getUserProfile"), findByStoreName("UserProfileStore")]
        .filter(Boolean)
        .forEach((store) => {
          if (!store.getUserProfile) return;
          patches.push(
            after("getUserProfile", store, (args, res) => {
              if (!res || !storage.removeBanner) return res;
              return getSanitizedProfile(res);
            })
          );
        });

      const userBannerMods = [findByProps("getUserBannerURL")].filter(Boolean);
      userBannerMods.forEach((mod) => {
        if (!mod.getUserBannerURL) return;
        patches.push(
          after("getUserBannerURL", mod, (args, url) => (storage.removeBanner ? null : url))
        );
      });

      const seen = new Set();
      const bannerHookMods = [findByProps("useUser", "useUserBanner"), findByProps("useUserBanner")]
        .filter(Boolean)
        .filter((mod) => {
          if (seen.has(mod)) return false;
          seen.add(mod);
          return true;
        });
      bannerHookMods.forEach((mod) => {
        if (mod.useUser) {
          patches.push(
            after("useUser", mod, (args, res) => {
              if (!res || !storage.removeBanner) return res;
              return getSanitizedUser(res);
            })
          );
        }
        if (mod.useUserBanner) {
          patches.push(
            after("useUserBanner", mod, (args, url) => (storage.removeBanner ? null : url))
          );
        }
      });
    };
    load();
  },
  onUnload() {
    patches.forEach((p) => p?.());
  },
};
