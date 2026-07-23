import { after } from "@vendetta/patcher";
import { findByProps, findByStoreName } from "@vendetta/metro";
import { storage } from "@vendetta/plugin";
import { React, ReactNative } from "@vendetta/metro/common";
import { Forms } from "@vendetta/ui/components";
import { showToast } from "@vendetta/ui/toasts";

storage.removeBanner ??= true;
storage.exemptFriends ??= true;
storage.bannerExceptions ??= [];

let patches = [];
const sanitizedCache = new WeakMap();

const RelationshipStore = findByStoreName("RelationshipStore");
const isFriend = (id) => {
  if (!id || !RelationshipStore) return false;
  try {
    if (RelationshipStore.isFriend) return RelationshipStore.isFriend(id);
    return RelationshipStore.getRelationshipType?.(id) === 1;
  } catch {
    return false;
  }
};

const isExempt = (id) => {
  if (!id) return false;
  const strId = String(id);
  if (storage.bannerExceptions.includes(strId)) return true;
  if (storage.exemptFriends && isFriend(strId)) return true;
  return false;
};

const shallowClonePreserveProto = (obj) => {
  if (!obj || typeof obj !== "object") return obj;
  const clone = Object.create(Object.getPrototypeOf(obj));
  Object.assign(clone, obj);
  return clone;
};

const getSanitizedUser = (user) => {
  if (!user || typeof user !== "object") return user;
  if (!storage.removeBanner || isExempt(user.id)) return user;
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
  const id = profile.userId ?? profile.user?.id;
  if (!storage.removeBanner || isExempt(id)) return profile;
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

const safe = (fn) => (...args) => {
  try {
    return fn(...args);
  } catch {
    return undefined;
  }
};

function Settings() {
  const [, forceUpdate] = React.useReducer((x) => x + 1, 0);
  const [input, setInput] = React.useState("");
  const { FormSwitchRow, FormInput, FormRow, FormSection, FormDivider } = Forms;
  const { View } = ReactNative;
  const UserStore = findByStoreName("UserStore");

  const addException = () => {
    const id = input.trim();
    if (!id) return;
    if (!/^\d+$/.test(id)) {
      showToast("Enter a valid user ID");
      return;
    }
    if (storage.bannerExceptions.includes(id)) {
      showToast("Already in the list");
      return;
    }
    storage.bannerExceptions.push(id);
    setInput("");
    forceUpdate();
  };

  const removeException = (id) => {
    storage.bannerExceptions = storage.bannerExceptions.filter((x) => x !== id);
    forceUpdate();
  };

  return (
    <View>
      <FormSection title="General">
        <FormSwitchRow
          label="Remove banners"
          subLabel="Strips banners from users everywhere"
          value={storage.removeBanner}
          onValueChange={(v) => {
            storage.removeBanner = v;
            forceUpdate();
          }}
        />
        <FormSwitchRow
          label="Keep friends' banners"
          subLabel="Friends are automatically whitelisted"
          value={storage.exemptFriends}
          onValueChange={(v) => {
            storage.exemptFriends = v;
            forceUpdate();
          }}
        />
      </FormSection>

      <FormSection title="Other exceptions">
        <FormInput
          title="User ID"
          placeholder="Add a non-friend's user ID to keep their banner"
          value={input}
          onChange={setInput}
          onSubmitEditing={addException}
          returnKeyType="done"
        />
        <FormDivider />
        {storage.bannerExceptions.length === 0 && (
          <FormRow label="No manual exceptions added" />
        )}
        {storage.bannerExceptions.map((id) => {
          const user = UserStore?.getUser?.(id);
          return (
            <FormRow
              key={id}
              label={user?.username ?? id}
              subLabel={id}
              onPress={() => removeException(id)}
            />
          );
        })}
      </FormSection>
    </View>
  );
}

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
            if (!res) return res;
            return getSanitizedUser(res);
          }))
        );
      }

      const userProfileStore = findByStoreName("UserProfileStore");
      if (userProfileStore?.getUserProfile) {
        patches.push(
          after("getUserProfile", userProfileStore, safe((args, res) => {
            if (!res) return res;
            return getSanitizedProfile(res);
          }))
        );
      }

      const bannerUrlMod = findByProps("getUserBannerURL", "getUserAvatarURL");
      if (bannerUrlMod?.getUserBannerURL) {
        patches.push(
          after("getUserBannerURL", bannerUrlMod, safe((args, url) => {
            const id = args?.[0]?.id ?? args?.[0];
            if (!storage.removeBanner || isExempt(id)) return url;
            return null;
          }))
        );
      }

      const hookMod = findByProps("useUser", "useUserBanner");
      if (hookMod) {
        if (hookMod.useUser) {
          patches.push(
            after("useUser", hookMod, safe((args, res) => {
              if (!res) return res;
              return getSanitizedUser(res);
            }))
          );
        }
        if (hookMod.useUserBanner) {
          patches.push(
            after("useUserBanner", hookMod, safe((args, url) => {
              const id = args?.[0];
              if (!storage.removeBanner || isExempt(id)) return url;
              return null;
            }))
          );
        }
      }
    };
    load();
  },
  onUnload() {
    patches.forEach((p) => p?.());
  },
  settings: Settings,
};
