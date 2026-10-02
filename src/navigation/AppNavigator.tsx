// React Navigation 栈 + Tab 导航
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import React from 'react';
import { BookOpen, Bookmark, UserRound } from 'lucide-react-native';

import { HomeScreen } from '../screens/HomeScreen';
import { ListScreen } from '../screens/ListScreen';
import { DetailScreen } from '../screens/DetailScreen';
import { FavoritesScreen } from '../screens/FavoritesScreen';
import { ProfileScreen } from '../screens/ProfileScreen';
import { colors, navigationTheme, typography } from '../theme';
import type { Question } from '../question-bank';

/** 详情页参数：browse 浏览 / practice 练习队列 / review 间隔复习队列（复用练习链路） */
export type DetailParams = {
  id: string;
  meta?: Question;
  queue?: string[];
  queueIndex?: number;
  mode?: 'browse' | 'practice' | 'review';
};

export type RootStackParamList = {
  Tabs: undefined;
  Detail: DetailParams;
};

export type HomeStackParamList = {
  Home: undefined;
  List: ListParams;
  Detail: DetailParams;
};

/** 列表页入口：来自分类（§5.1）或来自标签领域（向后兼容）。 */
export type ListParams = {
  tagId?: string;
  tagName?: string;
  categoryId?: string;
  categoryName?: string;
};

export type MainTabParamList = {
  HomeTab: undefined;
  Favorites: undefined;
  Profile: undefined;
};

const RootStack = createNativeStackNavigator<RootStackParamList>();
const HomeStackNavigator = createNativeStackNavigator<HomeStackParamList>();
const Tab = createBottomTabNavigator<MainTabParamList>();

function HomeStack() {
  return (
    <HomeStackNavigator.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
        headerTitleStyle: typography.heading,
        headerShadowVisible: false,
        headerBackTitle: '返回',
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <HomeStackNavigator.Screen
        name="Home"
        component={HomeScreen}
        options={{ headerShown: false }}
      />
      <HomeStackNavigator.Screen
        name="List"
        component={ListScreen}
        options={({ route }) => ({ title: route.params.tagName ?? '题目' })}
      />
      <HomeStackNavigator.Screen
        name="Detail"
        component={DetailScreen}
        options={{ title: '题目详情' }}
      />
    </HomeStackNavigator.Navigator>
  );
}

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textSubtle,
        tabBarLabelStyle: { ...typography.caption, fontWeight: '600' },
        tabBarStyle: {
          height: 66,
          paddingTop: 7,
          paddingBottom: 8,
          backgroundColor: colors.surface,
          borderTopColor: colors.borderSoft,
          // 内容滚动到底部时与底栏保持分层：极淡的顶部投影
          shadowColor: colors.text,
          shadowOffset: { width: 0, height: -2 },
          shadowOpacity: 0.03,
          shadowRadius: 8,
          elevation: 4,
        },
        tabBarIcon: ({ color, focused }) => {
          const Icon =
            route.name === 'HomeTab'
              ? BookOpen
              : route.name === 'Favorites'
                ? Bookmark
                : UserRound;
          return (
            <Icon
              color={color}
              size={22}
              strokeWidth={focused ? 2.3 : 1.8}
              fill={route.name === 'Favorites' && focused ? colors.primarySoft : 'none'}
            />
          );
        },
      })}
    >
        <Tab.Screen
          name="HomeTab"
          component={HomeStack}
          options={{ title: '题库' }}
        />
        <Tab.Screen
          name="Favorites"
          component={FavoritesScreen}
          options={{ title: '收藏' }}
        />
        <Tab.Screen
          name="Profile"
          component={ProfileScreen}
          options={{ title: '我的' }}
        />
    </Tab.Navigator>
  );
}

export function AppNavigator() {
  return (
    <NavigationContainer theme={navigationTheme}>
      <RootStack.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.text,
          headerTitleStyle: typography.heading,
          headerShadowVisible: false,
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <RootStack.Screen
          name="Tabs"
          component={MainTabs}
          options={{ headerShown: false }}
        />
        <RootStack.Screen
          name="Detail"
          component={DetailScreen}
          options={{ title: '题目详情' }}
        />
      </RootStack.Navigator>
    </NavigationContainer>
  );
}
