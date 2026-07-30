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

const isFriend = (id) => {
  if (!id) return false;
  try {
    const store = findByStoreName("RelationshipStore");
    if (!store) return false;
    if (store.isFriend) return store.isFriend(id);
    return store.getRelationshipType?.(id) === 1;
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

// Returns a shallow clone with banner fields nulled — never mutates the
// original, since Discord's profile records are frequently frozen and a
// direct assignment silently no-ops (or throws, which safe() swallows).
const stripBannerFields = (obj) => {
  if (!obj || typeof obj !== "object") return obj;
  return { ...obj, banner: null, bannerColor: null };
};

// Server-specific ("per-guild") profiles carry their own banner override,
// nested under a key that's commonly `guildMemberProfile`. If the field
// name differs on your client build, inspect a live getUserProfile()
// result in the debugger and adjust the key below.
const GUILD_PROFILE_KEY = "guildMemberProfile";

const applyBannerState = (profile, id) => {
  if (!profile || typeof profile !== "object" || !id) return profile;
  if (!storage.removeBanner || isExempt(id)) return profile;

  let result = stripBannerFields(profile);

  if (result[GUILD_PROFILE_KEY]) {
    result = {
      ...result,
      [GUILD_PROFILE_KEY]: stripBannerFields(result[GUILD_PROFILE_KEY]),
    };
  }

  return result;
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
  const { View, TouchableOpacity, Text } = ReactNative;
  const h = React.createElement;
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
    showToast("Added to exceptions");
  };

  const removeException = (id) => {
    storage.bannerExceptions = storage.bannerExceptions.filter((x) => x !== id);
    forceUpdate();
  };

  return h(
    View,
    null,
    h(
      FormSection,
      { title: "General" },
      h(FormSwitchRow, {
        label: "Remove banners",
        subLabel: "Strips banners from users everywhere, including server profiles",
        value: storage.removeBanner,
        onValueChange: (v) => {
          storage.removeBanner = v;
          forceUpdate();
        },
      }),
      h(FormSwitchRow, {
        label: "Keep friends' banners",
        subLabel: "Friends are automatically whitelisted",
        value: storage.exemptFriends,
        onValueChange: (v) => {
          storage.exemptFriends = v;
          forceUpdate();
        },
      })
    ),
    h(
      FormSection,
      { title: "Other exceptions" },
      h(FormInput, {
        title: "User ID",
        placeholder: "Add a non-friend's user ID to keep their banner",
        value: input,
        onChange: setInput,
        onSubmitEditing: addException,
        returnKeyType: "done",
      }),
      h(
        TouchableOpacity,
        {
          onPress: addException,
          style: {
            marginHorizontal: 16,
            marginTop: 8,
            marginBottom: 4,
            paddingVertical: 10,
            borderRadius: 8,
            backgroundColor: "#5865F2",
            alignItems: "center",
          },
        },
        h(Text, { style: { color: "#fff", fontWeight: "600" } }, "Add User ID")
      ),
      h(FormDivider, null),
      storage.bannerExceptions.length === 0 &&
        h(FormRow, { label: "No manual exceptions added" }),
      ...storage.bannerExceptions.map((id) => {
        const user = UserStore?.getUser?.(id);
        return h(FormRow, {
          key: id,
          label: user?.username ?? id,
          subLabel: id,
          onPress: () => removeException(id),
        });
      })
    )
  );
}

export default {
  onLoad() {
    const unloadPatches = () => patches.forEach((p) => p?.());

    const applyPatches = () => {
      unloadPatches();
      patches = [];

      const userStore = findByStoreName("UserStore");
      if (userStore?.getUser) {
        patches.push(
          after("getUser", userStore, safe((args, res) => {
            if (!res) return res;
            return { ...res, ...applyBannerState(res, res.id) };
          }))
        );
      }

      const userProfileStore = findByStoreName("UserProfileStore");
      if (userProfileStore?.getUserProfile) {
        patches.push(
          after("getUserProfile", userProfileStore, safe((args, res) => {
            if (!res) return res;
            const id = res.userId ?? res.user?.id ?? args?.[0];
            let next = applyBannerState(res, id);
            if (next.user) next = { ...next, user: applyBannerState(next.user, id) };
            return next;
          }))
        );
      }

      // Separate store some clients use specifically for per-guild member
      // profiles (server-specific banner/bio). Not always present.
      const guildMemberProfileStore = findByStoreName("GuildMemberProfileStore");
      if (guildMemberProfileStore?.getGuildMemberProfile) {
        patches.push(
          after("getGuildMemberProfile", guildMemberProfileStore, safe((args, res) => {
            if (!res) return res;
            const id = res.userId ?? args?.[1] ?? args?.[0];
            return applyBannerState(res, id);
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

      // Server-specific banner URL getter, if this client build has one.
      if (bannerUrlMod?.getGuildMemberBannerURL) {
        patches.push(
          after("getGuildMemberBannerURL", bannerUrlMod, safe((args, url) => {
            const id = args?.[0]?.userId ?? args?.[0]?.id ?? args?.[1];
            if (!storage.removeBanner || isExempt(id)) return url;
            return null;
          }))
        );
      }

      const hookMod = findByProps("useUserBanner");
      if (hookMod?.useUserBanner) {
        patches.push(
          after("useUserBanner", hookMod, safe((args, url) => {
            const id = args?.[0];
            if (!storage.removeBanner || isExempt(id)) return url;
            return null;
          }))
        );
      }
    };

    applyPatches();
  },
  onUnload() {
    patches.forEach((p) => p?.());
  },
  settings: Settings,
};
