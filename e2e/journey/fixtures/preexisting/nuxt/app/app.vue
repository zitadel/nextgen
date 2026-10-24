<!-- The host app's own shell: setup must leave it untouched, and the widget
     posture's auth pages render inside it (ADR 044). The journey asserts this
     header is visible on /login. -->
<template>
  <div>
    <header>
      <strong>Orbit Notes</strong>
      <nav>
        <NuxtLink to="/">Home</NuxtLink>
        <NuxtLink to="/login">Sign in</NuxtLink>
      </nav>
    </header>
    <NuxtPage />
  </div>
</template>
