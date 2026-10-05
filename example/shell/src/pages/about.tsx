import { Link } from "@satilian/router";
import Div from "host1/Div";
import Section from "host2/Section";
import { Suspense } from "react";

export const AboutPage = () => {
  return (
    <div>
      <h1>About Page</h1>

      <Suspense>
        <Section>
          <Div>This is the about page.</Div>

          <Link to="/">Home Page</Link>
        </Section>
      </Suspense>
    </div>
  );
};
